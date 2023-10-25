#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { BesuEnvStack } from '../lib/besu-env_cdk-stack';

const app = new cdk.App();
new BesuEnvStack (app, 'BesuEnvStack', {
  stackName: 'BesuEnv-Stack',
  env:{account:'Enter Account number',region:'us-east-1'}
});