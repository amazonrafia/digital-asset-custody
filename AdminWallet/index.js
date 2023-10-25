import { ethers } from "ethers";
import { SecretsManagerClient,CreateSecretCommand } from "@aws-sdk/client-secrets-manager";


let accountWallets = [];
let mnemonicStr = ethers.Wallet.createRandom().mnemonic.phrase;
console.log(mnemonicStr);
console.log("****************************************** Admin Account ****************************************\n");
for (let count = 0; count < 1; count++) {
    accountWallets.push(ethers.Wallet.fromMnemonic(mnemonicStr, `m/44'/60'/0'/0/${count}`, ethers.wordlists.en));
    console.log(`Ethereum Address: ${accountWallets[count].address}`);
    console.log(`Private Key: ${accountWallets[count].privateKey}`);
    console.log(`\n`);
}
//store private key in secret manager
const client = new SecretsManagerClient({region: "us-east-1"});
const input = { // CreateSecretRequest
    Name: "adminwallet", // required
    SecretString: `{\"privatekey\":\"${accountWallets[0].privateKey}\"}`
};
const command = new CreateSecretCommand(input);
const response = await client.send(command);
console.log(`Account private key has been stored in AWS Secrets Manager`);