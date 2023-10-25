#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { WalletServiceStack } from '../lib/walletservice-stack';

const app = new cdk.App();
new WalletServiceStack(app, 'WalletServiceStack', {
  stackName: 'WalletService-Stack'
});