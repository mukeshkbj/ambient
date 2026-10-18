import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

export type AmbientStackProps = cdk.StackProps & {
  instanceType?: string;
  dataVolumeGiB?: number;
};

export class AmbientStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AmbientStackProps = {}) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [{ name: "Public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 }]
    });
    const role = new iam.Role(this, "InstanceRole", { assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com") });
    role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"));
    const oauthSecret = new secretsmanager.Secret(this, "OAuthSecret", {
      generateSecretString: { secretStringTemplate: "{}", generateStringKey: "OAUTH_SIGNING_SECRET", passwordLength: 48, excludePunctuation: true }
    });
    oauthSecret.grantRead(role);
    const securityGroup = new ec2.SecurityGroup(this, "SecurityGroup", { vpc, allowAllOutbound: true });
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80));
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443));
    const instance = new ec2.Instance(this, "Bridge", {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: new ec2.InstanceType(props.instanceType ?? "t3.micro"),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      role,
      securityGroup,
      associatePublicIpAddress: true
    });
    const elasticIp = new ec2.CfnEIP(this, "BridgeElasticIp", { domain: "vpc" });
    new ec2.CfnEIPAssociation(this, "BridgeElasticIpAssociation", {
      allocationId: elasticIp.attrAllocationId,
      instanceId: instance.instanceId
    });
    // Auto-TLS via sslip.io: <dashed-eip>.sslip.io resolves to the Elastic IP,
    // and Caddy provisions the certificate on first connection.
    const publicHost = cdk.Fn.join("-", cdk.Fn.split(".", elasticIp.ref)) + ".sslip.io";
    instance.userData.addCommands(
      "set -euo pipefail",
      "DATA_DEVICE=/dev/sdf",
      "for attempt in $(seq 1 30); do if [ -b \"$DATA_DEVICE\" ]; then break; fi; sleep 2; done",
      "if [ ! -b \"$DATA_DEVICE\" ]; then exit 1; fi",
      "if ! blkid \"$DATA_DEVICE\" >/dev/null 2>&1; then mkfs -t ext4 \"$DATA_DEVICE\"; fi",
      "mkdir -p /opt/ambient/data /opt/ambient/app",
      "chown -R ec2-user:ec2-user /opt/ambient",
      "mountpoint -q /opt/ambient/data || mount \"$DATA_DEVICE\" /opt/ambient/data",
      "grep -q \"/opt/ambient/data\" /etc/fstab || echo \"$DATA_DEVICE /opt/ambient/data ext4 defaults,nofail 0 2\" >> /etc/fstab",
      // Node 22 (engines >=22.13) — official tarball; AL2023's nodejs packages lag.
      "curl -fsSL https://nodejs.org/dist/v22.21.0/node-v22.21.0-linux-x64.tar.xz -o /tmp/node.tar.xz",
      "tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1",
      "corepack enable && corepack prepare pnpm@10.33.0 --activate || npm i -g pnpm@10.33.0",
      // Caddy via the official COPR repo; auto-TLS for the sslip.io hostname.
      "dnf install -y 'dnf-command(copr)'",
      "dnf -y copr enable @caddy/caddy",
      "dnf install -y caddy jq",
      // Secrets → env: rendered at every boot so rotation only needs a restart.
      "cat > /usr/local/bin/ambient-env <<'EOS'\n#!/bin/sh\nset -eu\naws secretsmanager get-secret-value --secret-id '" + oauthSecret.secretArn + "' --query SecretString --output text | jq -r 'to_entries[]|\"\\(.key)=\\(.value)\"' > /opt/ambient/ambient.env\nEOS",
      "chmod +x /usr/local/bin/ambient-env",
      // systemd unit; the app itself lands via SSM/rsync per docs/deployment.md.
      "cat > /etc/systemd/system/ambient.service <<'EOS'\n[Unit]\nDescription=Ambient MCP bridge\nAfter=network-online.target\n\n[Service]\nType=simple\nExecStartPre=/usr/local/bin/ambient-env\nEnvironmentFile=/opt/ambient/ambient.env\nEnvironment=PORT=3000\nEnvironment=AMBIENT_DATA_DIR=/opt/ambient/data\nEnvironment=AWS_REGION=" + this.region + "\nEnvironment=PUBLIC_BASE_URL=https://" + publicHost + "\nEnvironment=ALEXA_VERIFY_SIGNATURE=true\nWorkingDirectory=/opt/ambient/app\nExecStart=/usr/local/bin/node dist/src/server.js\nRestart=on-failure\nRestartSec=5\nUser=ec2-user\n\n[Install]\nWantedBy=multi-user.target\nEOS",
      "cat > /etc/caddy/Caddyfile <<'EOS'\n" + publicHost + " {\n  reverse_proxy 127.0.0.1:3000\n}\nEOS",
      "systemctl daemon-reload",
      "systemctl enable caddy ambient",
      "systemctl start caddy"
    );
    const volume = new ec2.CfnVolume(this, "DataVolume", {
      availabilityZone: instance.instanceAvailabilityZone,
      encrypted: true,
      size: props.dataVolumeGiB ?? 20,
      volumeType: "gp3"
    });
    volume.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
    new ec2.CfnVolumeAttachment(this, "DataVolumeAttachment", {
      device: "/dev/sdf",
      instanceId: instance.instanceId,
      volumeId: volume.ref
    });
    new cdk.CfnOutput(this, "BridgeInstanceId", { value: instance.instanceId });
    new cdk.CfnOutput(this, "BridgePublicIp", { value: elasticIp.ref });
    new cdk.CfnOutput(this, "BridgePublicUrl", { value: `https://${publicHost}` });
    new cdk.CfnOutput(this, "OAuthSecretArn", { value: oauthSecret.secretArn });
  }
}
