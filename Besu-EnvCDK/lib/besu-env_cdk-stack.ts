import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as datasync from 'aws-cdk-lib/aws-datasync';
import * as awslogs from 'aws-cdk-lib/aws-logs';

import { EFS_DEFAULT_ENCRYPTION_AT_REST } from 'aws-cdk-lib/cx-api';

import * as path from 'path';

export class BesuEnvStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    //get account and region of this stack
    let account = this.account;
    let region = this.region;

    let getUUID = () => {
      let d = new Date().getTime();
      const guid = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (d + Math.random() * 16) % 16 | 0;
        d = Math.floor(d / 16);
        return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
      });
      return guid;
    }
    
    let vpc=ec2.Vpc.fromLookup(this,'defaultVPC',{isDefault:true});
    let publicSubnetArn1 = `arn:aws:ec2:${region}:${account}:subnet/${vpc.publicSubnets[0].subnetId}`;
    let publicSubnetArn2 = `arn:aws:ec2:${region}:${account}:subnet/${vpc.publicSubnets[1].subnetId}`;

    /************************ Security Group ********************/
    let secGroup = new ec2.SecurityGroup(this, 'AMB-CICD-Blog-SecGroup', {
      vpc,
      description: 'Allow SSH traffic and all traffic within this group',
      allowAllOutbound: true,
      securityGroupName: "AMB-CICD-Blog-SecGroup"
    });
    secGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(8545), 'All Ethreum HTTP RPC Traffic');
    secGroup.addIngressRule(secGroup, ec2.Port.allTraffic(), 'Allow all traffic associated with this security group');
    let securityGroupArn = `arn:aws:ec2:${region}:${account}:security-group/${secGroup.securityGroupId}`;

    /************************ IAM Policies & Role ********************/
    //Besu-NodeContainerExecutionRole
    let besuECSExecRole = new iam.Role(this, "AMB-CICD-Blog-BesuECSExecRole", {
      roleName: "AMB-CICD-Blog-BesuECSExecRole",
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      description: "ECS task will assume this role to run besu node on ECS",
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchLogsFullAccess"),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonElasticFileSystemClientFullAccess")]
    });
    
    //custom resource lambda role
    let customResourceLambdaRole = new iam.Role(this, "AMB-CICD-Blog-CustomResourceLambdaRole", {
      roleName: "AMB-CICD-Blog-CustomResourceLambdaRole",
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: "Custome resource lambda will assume this role",
      managedPolicies: [
        //secReadPolicy,
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaVPCAccessExecutionRole"),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonElasticFileSystemClientFullAccess"),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AWSDataSyncFullAccess"),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonECS_FullAccess"),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEC2FullAccess")
      ]
    });
    
    //DataSync role for file transfer from S3 to EFS
    let dataSyncTransferRole = new iam.Role(this, "AMB-CICD-Blog-DataSyncTransferRole", {
      roleName: "AMB-CICD-Blog-DataSyncTransferRole",
      assumedBy: new iam.ServicePrincipal("datasync.amazonaws.com"),
      description: "DataSync role for file transfer from S3 to EFS",
      managedPolicies: [
        //secReadPolicy,
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonS3FullAccess"),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonElasticFileSystemClientFullAccess")
      ]
    });

    /************************ Create EFS file system for Besu ********************/
    let elasticFileSys = new efs.FileSystem(this, "AMB-CICD-Blog-EFS", {
      fileSystemName: "AMB-CICD-Blog-EFS",
      vpc: vpc,
      enableAutomaticBackups: true,
      encrypted: true,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_30_DAYS,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode: efs.ThroughputMode.BURSTING,
      securityGroup: secGroup,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY
    })
    
    //create EFS access point
    let efsBesuDirAccessPoint = new efs.AccessPoint(this, "AMB-CICD-Blog-BesuDirAccessPoint", {
      fileSystem: elasticFileSys,
      path: "/besu-dev-network",
      createAcl: {
        ownerUid: '1000',
        ownerGid: '1000',
        permissions: '777',
      },
      // enforce the POSIX identity so lambda function will access with this identity
      posixUser: {
        uid: '1000',
        gid: '1000',
      }
    });

    //lambda EFS management OnEvent function
    let lambdaEFSMgntFuncOnEvent = new lambda.Function(this, "AMB-CICD-Blog-EFSManagmentOnEvent", {
      functionName: "AMB-CICD-Blog-EFSManagmentOnEvent",
      allowPublicSubnet: true,
      filesystem: lambda.FileSystem.fromEfsAccessPoint(efsBesuDirAccessPoint, '/mnt/efs'),
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, 'EFSManagement/OnEvent')),
      timeout: cdk.Duration.seconds(300),
      role: customResourceLambdaRole,
      vpc: vpc
    });
    let lambdaEFSMgntFuncOnComplete = new lambda.Function(this, "AMB-CICD-Blog-EFSManagmentOnComplete", {
      functionName: "AMB-CICD-Blog-EFSManagmentOnComplete",
      allowPublicSubnet: true,
      filesystem: lambda.FileSystem.fromEfsAccessPoint(efsBesuDirAccessPoint, '/mnt/efs'),
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, 'EFSManagement/OnComplete')),
      timeout: cdk.Duration.seconds(300),
      role: customResourceLambdaRole,
      vpc: vpc
    });
    let efsLambdaMgmtProvider = new cr.Provider(this, "amb-cicd-efsLambdaMgmtProvider", {
      onEventHandler: lambdaEFSMgntFuncOnEvent,
      isCompleteHandler: lambdaEFSMgntFuncOnComplete,
    })
    //custom resource to execute the EFS lambda
    let custRsrcEfsMgmtLambdaExec = new cdk.CustomResource(this, "AMB-CICD-Blog-CustRsrcEfsMgmtLambdaExec", {
      serviceToken: efsLambdaMgmtProvider.serviceToken
    });
    custRsrcEfsMgmtLambdaExec.node.addDependency(elasticFileSys);
    
    /************************ S3 Bucket and supporting files for the CI/CD solution ********************/
    let bucketName="amb-cicd-blog-s3bucket" + getUUID();
    let cicdBucket = new s3.Bucket(this, "AMB-CICD-Blog-S3Bucket", {
      bucketName: bucketName,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: true
    });

    let s3fileDeploy = new s3deploy.BucketDeployment(this, "AMB-CICD-Blog-S3FileDeploy", {
      sources: [s3deploy.Source.asset(path.join(__dirname, "../resources/BucketFiles"))],
      destinationBucket: cicdBucket
    });

    /************************ DataSync to transfer files from S3 to EFS ********************/
    let s3Location = new datasync.CfnLocationS3(this, "AMB-CICD-Blog-S3Location", {
      s3Config: {
        bucketAccessRoleArn: dataSyncTransferRole.roleArn
      },
      s3BucketArn: cicdBucket.bucketArn,
    });
    s3Location.node.addDependency(cicdBucket);

    let efsLocation = new datasync.CfnLocationEFS(this, "AMB-CICD-Blog-EFSLocation", {
      ec2Config: {
        subnetArn: publicSubnetArn1,
        securityGroupArns: [securityGroupArn]
      },
      accessPointArn: efsBesuDirAccessPoint.accessPointArn,
      efsFilesystemArn: elasticFileSys.fileSystemArn,
      fileSystemAccessRoleArn: dataSyncTransferRole.roleArn,
      inTransitEncryption: "TLS1_2",
      subdirectory: "config"
    });
    efsLocation.node.addDependency(elasticFileSys);
    efsLocation.node.addDependency(efsBesuDirAccessPoint);
    efsLocation.node.addDependency(custRsrcEfsMgmtLambdaExec);

    let dataSyncTaskLogGroup = new awslogs.LogGroup(this, "AMB-CICD-Blog-DataSyncTaskLogGroup", {
      logGroupName: "AMB-CICD-Blog-DataSyncTaskLogGroup",
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });
    dataSyncTaskLogGroup.grantWrite(new iam.ServicePrincipal("datasync.amazonaws.com"));

    let dataSyncTask = new datasync.CfnTask(this, "AMB-CICD-Blog-DataSyncTask", {
      name: "AMB-CICD-Blog-DataSyncTask",
      sourceLocationArn: s3Location.attrLocationArn,
      destinationLocationArn: efsLocation.attrLocationArn,
      includes: [
        {
          filterType: "SIMPLE_PATTERN",
          value: "/config.toml|/dev.json"
        }
      ],
      cloudWatchLogGroupArn: dataSyncTaskLogGroup.logGroupArn,
      options: {
        logLevel: "TRANSFER",
        overwriteMode: "ALWAYS",
        transferMode: "ALL",
        verifyMode: "ONLY_FILES_TRANSFERRED",
        posixPermissions: "NONE",
        uid: "NONE",
        gid: "NONE"
      }
    });
    dataSyncTask.node.addDependency(s3Location);
    dataSyncTask.node.addDependency(efsLocation);
    dataSyncTask.node.addDependency(dataSyncTaskLogGroup);

    //DataSync Task Execution OnEvent function
    let lambdaDataSyncTastExecFuncOnEvent = new lambda.Function(this, "AMB-CICD-Blog-DataSyncTastExecOnEvent", {
      code: lambda.Code.fromAsset(path.join(__dirname, 'DataSyncTaskExec/OnEvent')),
      handler: "index.handler",
      runtime: lambda.Runtime.NODEJS_18_X,
      description: "Lambda to move files from S3 to EFS via DataSync Task",
      environment: { "STACK_REGION": region, "TASK_ARN": dataSyncTask.attrTaskArn },
      functionName: "AMB-CICD-Blog-DataSyncTastExecOnEvent",
      timeout: cdk.Duration.seconds(600),
      role: customResourceLambdaRole
    });

    //DataSync Task Execution Lambda function
    let lambdaDataSyncTastExecFuncOnComplete = new lambda.Function(this, "AMB-CICD-Blog-DataSyncTastExecOnComplete", {
      code: lambda.Code.fromAsset(path.join(__dirname, 'DataSyncTaskExec/OnComplete')),
      handler: "index.handler",
      runtime: lambda.Runtime.NODEJS_18_X,
      description: "Lambda to move files from S3 to EFS via DataSync Task",
      environment: { "STACK_REGION": region, "TASK_ARN": dataSyncTask.attrTaskArn },
      functionName: "AMB-CICD-Blog-DataSyncTastExecOnComplete",
      timeout: cdk.Duration.seconds(600),
      role: customResourceLambdaRole
    });
    let dataSyncTaskExecProvider = new cr.Provider(this, "amb-cicd-dataSyncTaskExecProvider", {
      onEventHandler: lambdaDataSyncTastExecFuncOnEvent,
      isCompleteHandler: lambdaDataSyncTastExecFuncOnComplete,
    })

    //custom resource to execute the EFS lambda
    let custRsrcDataSyncTaskLambdaExec = new cdk.CustomResource(this, "AMB-CICD-Blog-CustRsrcDataSyncTaskLambdaExec", {
      serviceToken: dataSyncTaskExecProvider.serviceToken
    });
    custRsrcDataSyncTaskLambdaExec.node.addDependency(dataSyncTask);


    /************************ ECS and Besu Node ********************/
    let besuNetworkCluster = new ecs.Cluster(this, "AMB-CICD-Blog-BesuNetworkCluster", {
      clusterName: "AMB-CICD-Blog-BesuNetworkCluster",
      enableFargateCapacityProviders: true,
      vpc: vpc
    });

    let besuNetworkTaskDef = new ecs.FargateTaskDefinition(this, "AMB-CICD-Blog-BesuNetworkTaskDef", {
      cpu: 2048,
      executionRole: besuECSExecRole,
      family: "AMB-CICD-Blog-BesuDevNetwork",
      memoryLimitMiB: 4096,
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX
      },
      taskRole: besuECSExecRole,
      volumes: [
        {
          name: "EfsBesuNodeStorage",
          efsVolumeConfiguration: {
            fileSystemId: elasticFileSys.fileSystemId,
            rootDirectory: "/",
            transitEncryption: "ENABLED",
            authorizationConfig: {
              accessPointId: efsBesuDirAccessPoint.accessPointId,
              iam: "ENABLED"
            }
          }
        }
      ]
    });
    besuNetworkTaskDef.node.addDependency(besuECSExecRole);

    let besuNetworkContainDef = new ecs.ContainerDefinition(this, "AMB-CICD-Blog-BesuNetworkContainDef", {
      image: ecs.ContainerImage.fromRegistry("hyperledger/besu"),
      taskDefinition: besuNetworkTaskDef,
      containerName: "BesudevNode1",
      entryPoint: [
        "/bin/bash",
        "-c",
        "/opt/besu/bin/besu --config-file=/mount/efs/config/config.toml --genesis-file=/mount/efs/config/dev.json --data-path=/mount/efs/devNode1/data"
      ],
      essential: true,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "ecs",
        logGroup: new awslogs.LogGroup(this, "AMB-CICD-Blog-BesuNetworkLogGroup", {
          logGroupName: "/ecs/besudevnetwork",
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        })
      }),
      portMappings: [
        {
          containerPort: 8545,
          protocol: ecs.Protocol.TCP
        },
        {
          containerPort: 8546,
          protocol: ecs.Protocol.TCP
        },
        {
          containerPort: 8547,
          protocol: ecs.Protocol.TCP
        },
        {
          containerPort: 9001,
          protocol: ecs.Protocol.TCP
        },
        {
          containerPort: 30303,
          protocol: ecs.Protocol.TCP
        },
        {
          containerPort: 9545,
          protocol: ecs.Protocol.TCP
        },
        {
          containerPort: 30303,
          protocol: ecs.Protocol.UDP
        },
        {
          containerPort: 9545,
          protocol: ecs.Protocol.UDP
        },
      ],
    });
    besuNetworkContainDef.node.addDependency(besuNetworkTaskDef);

    besuNetworkContainDef.addMountPoints(
      {
        containerPath: "/mount/efs",
        readOnly: false,
        sourceVolume: "EfsBesuNodeStorage"
      }
    )

    //Besu node custom resource handler for OnEvent
    let lambdaBesuEcsTaskStartFuncOnEvent = new lambda.Function(this, "AMB-CICD-Blog-BesuEcsTaskStartOnEvent", {
      code: lambda.Code.fromAsset(path.join(__dirname, 'ECSTaskExec/OnEvent')),
      handler: "index.handler",
      runtime: lambda.Runtime.NODEJS_18_X,
      description: "Lambda to start Besu node on ecs and capture the container public ip",
      environment: { "STACK_REGION": region, "TASK_DEF_ARN": besuNetworkTaskDef.taskDefinitionArn, "CLUSTER_NAME": besuNetworkCluster.clusterName, "TASK_SUBNETID": vpc.publicSubnets[0].subnetId, "SEC_GROUP_ID": secGroup.securityGroupId },
      functionName: "AMB-CICD-Blog-BesuEcsTaskStartOnEvent",
      timeout: cdk.Duration.seconds(100),
      role: customResourceLambdaRole,
    });
    //Besu node custom resource handler for OnComplete
    let lambdaBesuEcsTaskStartFuncOnComplete = new lambda.Function(this, "AMB-CICD-Blog-BesuEcsTaskStartOnComplete", {
      code: lambda.Code.fromAsset(path.join(__dirname, 'ECSTaskExec/OnComplete')),
      handler: "index.handler",
      runtime: lambda.Runtime.NODEJS_18_X,
      description: "Lambda to start Besu node on ecs and capture the container public ip",
      environment: { "STACK_REGION": region, "CLUSTER_NAME": besuNetworkCluster.clusterName },
      functionName: "AMB-CICD-Blog-BesuEcsTaskStartOnComplete",
      timeout: cdk.Duration.seconds(100),
      role: customResourceLambdaRole,
    });

    let ecsTaskExecProvider = new cr.Provider(this, "amb-cicd-ecsTaskExecProvider", {
      onEventHandler: lambdaBesuEcsTaskStartFuncOnEvent,
      isCompleteHandler: lambdaBesuEcsTaskStartFuncOnComplete,
    })

    //custom resource to start ECS fargate task for besu node
    let custRsrcEcsTaskLambdaExec = new cdk.CustomResource(this, "AMB-CICD-Blog-CustRsrcEcsTaskLambdaExec", {
      serviceToken: ecsTaskExecProvider.serviceToken
    });
    custRsrcEcsTaskLambdaExec.node.addDependency(custRsrcDataSyncTaskLambdaExec);
    custRsrcEcsTaskLambdaExec.node.addDependency(besuNetworkCluster);
    custRsrcEcsTaskLambdaExec.node.addDependency(besuNetworkContainDef);

    //Get the public ip of the container
    let besuNodePublicIp = custRsrcEcsTaskLambdaExec.getAttString("PublicIp");
    let IPOutput = new cdk.CfnOutput(this, "BesuNodePublicIP", { value: besuNodePublicIp });

  }
}

