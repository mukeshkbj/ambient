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
    const connectorSecret = new secretsmanager.Secret(this, "ConnectorSecret", {
      generateSecretString: { secretStringTemplate: "{}", generateStringKey: "CONNECTOR_TOKEN", passwordLength: 48, excludePunctuation: true }
    });
    const oauthSecret = new secretsmanager.Secret(this, "OAuthSecret", {
      generateSecretString: { secretStringTemplate: "{}", generateStringKey: "OAUTH_SIGNING_SECRET", passwordLength: 48, excludePunctuation: true }
    });
    connectorSecret.grantRead(role);
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
    instance.userData.addCommands(
      "set -euo pipefail",
      "DATA_DEVICE=/dev/sdf",
      "for attempt in $(seq 1 30); do if [ -b \"$DATA_DEVICE\" ]; then break; fi; sleep 2; done",
      "if [ ! -b \"$DATA_DEVICE\" ]; then exit 1; fi",
      "if ! blkid \"$DATA_DEVICE\" >/dev/null 2>&1; then mkfs -t ext4 \"$DATA_DEVICE\"; fi",
      "mkdir -p /opt/hermesambient/data",
      "mountpoint -q /opt/hermesambient/data || mount \"$DATA_DEVICE\" /opt/hermesambient/data",
      "grep -q \"/opt/hermesambient/data\" /etc/fstab || echo \"$DATA_DEVICE /opt/hermesambient/data ext4 defaults,nofail 0 2\" >> /etc/fstab"
    );
    const volume = new ec2.CfnVolume(this, "DataVolume", {
      availabilityZone: vpc.publicSubnets[0]!.availabilityZone,
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
    const elasticIp = new ec2.CfnEIP(this, "BridgeElasticIp", { domain: "vpc" });
    new ec2.CfnEIPAssociation(this, "BridgeElasticIpAssociation", {
      allocationId: elasticIp.attrAllocationId,
      instanceId: instance.instanceId
    });
    new cdk.CfnOutput(this, "BridgeInstanceId", { value: instance.instanceId });
    new cdk.CfnOutput(this, "BridgePublicIp", { value: elasticIp.ref });
    new cdk.CfnOutput(this, "ConnectorSecretArn", { value: connectorSecret.secretArn });
    new cdk.CfnOutput(this, "OAuthSecretArn", { value: oauthSecret.secretArn });
  }
}
