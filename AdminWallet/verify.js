import { ethers } from "ethers";
import { SecretsManagerClient,GetSecretValueCommand} from "@aws-sdk/client-secrets-manager";

let GoerliTbaUrl;
let adminAddress=process.env.ADMIN_ETH_ADDRESS;
let chainProvider;

let getAccountEthBalance=async ()=>{
    console.log(`Admin account ${adminAddress} has ${await chainProvider.getBalance(adminAddress)} Wei`);
};


(async () => {
    let secret_name = "GoerliAccess";
    let secClient = new SecretsManagerClient({region: "us-east-1"});
    try {
        let response = await secClient.send(
            new GetSecretValueCommand({
                SecretId: secret_name,
                VersionStage: "AWSCURRENT", // VersionStage defaults to AWSCURRENT if unspecified
            })
        );
        GoerliTbaUrl = JSON.parse(response.SecretString)["ambtbaurl"];
        chainProvider = ethers.getDefaultProvider(GoerliTbaUrl);
        await getAccountEthBalance();

    }
    catch (error) {
        throw error;
    }
})();



 