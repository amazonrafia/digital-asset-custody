import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as apigateway from '@aws-cdk/aws-apigatewayv2-alpha';
import * as apiIntegration from '@aws-cdk/aws-apigatewayv2-integrations-alpha';
import * as path from 'path';

export class WalletServiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    //get account and region of this stack
    let account = this.account;
    let region = this.region;

    //get the default vpc
    //let vpc = ec2.Vpc.fromLookup(this, 'DefaultVPC', { isDefault: true });
    
    //DynamoDb Read/Write access for Lambda
    let dynamoDBReadWritePolicy = new iam.ManagedPolicy(this, "DigAssetCustWrk-DynamoDBReadWrite", {
      managedPolicyName: "DigAssetCustWrk-DynamoDBReadWrite",
      statements: [new iam.PolicyStatement({
        sid: "DigAssetCustWrkPolicy1",
        actions: [
          "dynamodb:PutItem",
          "dynamodb:DeleteItem",
          "dynamodb:PartiQLUpdate",
          "dynamodb:Scan",
          "dynamodb:Query",
          "dynamodb:UpdateItem",
          "dynamodb:PartiQLSelect",
          "dynamodb:DescribeTable",
          "dynamodb:PartiQLInsert",
          "dynamodb:GetItem",
          "dynamodb:UpdateTable",
          "dynamodb:GetRecords",
          "dynamodb:PartiQLDelete"
        ],
        effect: iam.Effect.ALLOW,
        resources: ["*"]
      })]
    });

    //SecretManagerReadAccess Policy
    let secReadPolicy = new iam.ManagedPolicy(this, "DigAssetCustWrk-SecretMgrReadAccess", {
      managedPolicyName: "DigAssetCustWrkg-SecretMgrReadAccess",
      statements: [new iam.PolicyStatement({
        sid: "DigAssetCustWrkPolicy2",
        actions: ["secretsmanager:GetSecretValue"],
        effect: iam.Effect.ALLOW,
        resources: ["*"]
      })]
    });

    //kms key creation policy
    let kmsCreatePolicy=new iam.ManagedPolicy(this, "DigAssetCustWrk-KMSCreation", {
      managedPolicyName: "DigAssetCustWrk-KMSCreation",
      statements: [new iam.PolicyStatement({
        sid: "DigAssetCustWrkPolicy3",
        actions: [
          "kms:Create*",
          "kms:Describe*"
        ],
        effect: iam.Effect.ALLOW,
        resources: ["*"]
      })]
    });

    //Wallet Service Execution Role
    let lambdaExecRole = new iam.Role(this, "DigAssetCustWrk-LambdaExecRole", {
      roleName: "DigAssetCustWrk-LambdaExecRole",
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: "NFT marketplace lambda will assume this role",
      managedPolicies: [
        secReadPolicy,
        dynamoDBReadWritePolicy,
        kmsCreatePolicy,
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole")
      ]
    });

    //create db to hold user keyid and public address
    let UserKeyMapping = new dynamodb.Table(this, "DigAssetCustWrk-UserKeyMappingDB", {
      tableName: "DigAssetCustWrk-UserKeyMappingDB",
      partitionKey: { name: "UserEmail", type: dynamodb.AttributeType.STRING },
      readCapacity: 1,
      writeCapacity: 1,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    //lambda layer for all the dependencies
    let walletServiceLambdaLayer = new lambda.LayerVersion(this, "DigAssetCustWrk-walletSrvLambdaLayer", {
      code: lambda.Code.fromAsset(path.join(__dirname, 'DigAssetCustWrkLayer.zip')),
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    //wallet service lambda
    let walletServiceLambda = new lambda.Function(this, "DigAssetCustWrk-WalletSvcLambda", {
      code: lambda.Code.fromAsset(path.join(__dirname, 'WalletService/')),
      handler: "index.handler",
      runtime: lambda.Runtime.NODEJS_18_X,
      description: "Lambda to implement Digital Wallet functionality",
      environment: { "DYNAMODB_NAME": UserKeyMapping.tableName,"SECRET_MGR_STR":"adminwallet","LAMBDA_EXEX_ROLE": lambdaExecRole.roleArn,"COIN_CONTRACT_ADDRESS":"0xF8516b792d7054df9A32D32EE9b5F4d80Ce8fFec","NETWORK_ENDPOINT":""},
      functionName: "DigAssetCustWrk-WalletSvcLambda",
      paramsAndSecrets:lambda.ParamsAndSecretsLayerVersion.fromVersion(lambda.ParamsAndSecretsVersions.V1_0_103),
      layers: [walletServiceLambdaLayer],
      role: lambdaExecRole,
      timeout: cdk.Duration.seconds(180),
      //vpc:vpc
    });
    walletServiceLambda.node.addDependency(lambdaExecRole);

    //api gateway for Wallet Service lambda
    let httpApiWalletService = new apigateway.HttpApi(this, "DigAssetCustWrk-WalletService", {
      apiName: "DigAssetCustWrk-WalletService",
    });
    httpApiWalletService.addRoutes({
      path: "/{proxy+}",
      methods: [apigateway.HttpMethod.ANY],
      integration: new apiIntegration.HttpLambdaIntegration("WalletServiceLambdaIntegration", walletServiceLambda),
    })
    //add permissions for the api gateway
    walletServiceLambda.addPermission("walletServiceLambdaPermission", {
      action: "lambda:InvokeFunction",
      principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
      sourceArn: `arn:aws:execute-api:${region}:${account}:${httpApiWalletService.httpApiId}/*/*/{proxy+}`
    });
  }
}
