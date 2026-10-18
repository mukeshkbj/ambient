import * as cdk from "aws-cdk-lib";
import { AmbientStack } from "./stack.js";

const app = new cdk.App();
new AmbientStack(app, "AmbientStack", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  instanceType: app.node.tryGetContext("instanceType") ?? "t3.micro",
  dataVolumeGiB: Number(app.node.tryGetContext("dataVolumeGiB") ?? 20)
});
