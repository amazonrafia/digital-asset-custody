import Web3 from 'web3';
import WalletService from './WalletService.mjs'

/*global fetch*/

let walletsvc = new WalletService();
let web3 = new Web3(new Web3.providers.HttpProvider(process.env.NETWORK_ENDPOINT));
let adminPrivateKey = "";
let adminWallet;

//lambda Singleton object
let lambdaSingleton = async () => {
    if (adminPrivateKey == "") {
        try {
            let secretValue = await fetch(`http://localhost:2773/secretsmanager/get?secretId=${encodeURIComponent(process.env.SECRET_MGR_STR)}`, { headers: { 'X-Aws-Parameters-Secrets-Token': process.env.AWS_SESSION_TOKEN, 'Content-Type': 'application/json' } });
            let jsonTxt = await secretValue.json();
            adminPrivateKey = JSON.parse(jsonTxt.SecretString)["privatekey"];
            adminWallet = web3.eth.accounts.wallet.add(adminPrivateKey);
        }
        catch (e) {
            console.log('error occurred in get setret from secret manager');
            throw e;
        }
    }
}
let signTx = async (FromAccountEmail, ToAddress, nonce, gasPrice, gasLimit, value, data) => {
    let signedTx = await walletsvc.createSignTransaction(FromAccountEmail, ToAddress, nonce, gasPrice, gasLimit, value, data);
    return signedTx;
}
let sendEthersFromAdminAccount = async (email, ethAmount, TxGasPrice, TxGasLimit) => {

    let account = adminWallet;
    let toAddress = await walletsvc.getEthAddressFromDB(email);
    try {
        let receipt = await this.web3.eth.sendTransaction({
            from: account.address,
            to: toAddress,
            value: ethAmount * 1000000000000000000,
            gasPrice: TxGasPrice,
            gasLimit: TxGasLimit,
            // other transaction's params
        });
        return { 'status': 'Success', 'Transaction Receipt': receipt };
    }
    catch (error) {
        console.log(error);
    }

}

let getCoinTransferData = (toEthAddress, coinValue) => {
    let returnData = "";
    let encodingStrs = [];
    encodingStrs.push(this.web3.eth.abi.encodeFunctionSignature("transfer(address,uint256)"));
    encodingStrs.push(this.web3.eth.abi.encodeParameter('address', toEthAddress));
    encodingStrs.push(this.web3.eth.abi.encodeParameter('uint256', coinValue));


    for (let i = 0; i < encodingStrs.length; i++) {
        let strLowerCase = encodingStrs[i].toLowerCase();
        if (strLowerCase.startsWith("0x")) {
            returnData += encodingStrs[i].substring(2);
        }
        else {
            returnData += encodingStrs[i];
        }
    }
    return '0x' + returnData;
}
export const handler = async (event) => {
    await lambdaSingleton();
    try {
        let urlPath = "" + event.rawPath;
        let urlParam = "";
        if (urlPath.lastIndexOf("/") > 0) {
            urlParam = urlPath.substring(urlPath.lastIndexOf("/") + 1);
            urlPath = urlPath.substring(0, urlPath.lastIndexOf("/"));
        }
        let resValue = {};
        let bodyPayload;

        switch (urlPath) {
            case '/createwallet':
                bodyPayload = JSON.parse(event.body);
                let emailusername = bodyPayload["email"].replaceAll("@", "_").replaceAll(".", "_");
                resValue = await walletsvc.createWallet(bodyPayload["email"], emailusername);
                break;
            case '/signTx':
                bodyPayload = JSON.parse(event.body);
                let SignedTransaction = await signTx(bodyPayload["email"], bodyPayload["ToEthAccount"], bodyPayload["nonce"], bodyPayload["gasPrice"], bodyPayload["gasLimit"], bodyPayload["TxValue"], bodyPayload["TxData"]);
                resValue = { "SignedTx": SignedTransaction };
                break;
            case '/signandsubmit':
                bodyPayload = JSON.parse(event.body);
                let TxToSubmit = await signTx(bodyPayload["email"], bodyPayload["ToEthAccount"], bodyPayload["nonce"], bodyPayload["gasPrice"], bodyPayload["gasLimit"], bodyPayload["TxValue"], bodyPayload["TxData"]);
                let submittedTxHash = await web3.eth.sendSignedTransaction(TxToSubmit);
                resValue = { "TransactionHash": transactionHash };
                break;
            case '/sendethers':
                bodyPayload = JSON.parse(event.body);
                let senderEmail = bodyPayload["email"];
                let receiverAddress = bodyPayload["ToEthAccount"];
                let amountToSend = bodyPayload["amount"] * 1000000000000000000;
                let senderAddress = await walletsvc.getEthAddressFromDB(senderEmail);
                let sendergasprice = 20000000000;
                let sendergaslimit = 5000000;
                let nonce = await web3.eth.getTransactionCount(senderAddress);


                if (bodyPayload["gasprice"] != null || bodyPayload["gasprice"] != undefined || bodyPayload["gasprice"] != "") {
                    sendergasprice = bodyPayload["gasprice"];
                }
                if (bodyPayload["gaslimit"] != null || bodyPayload["gaslimit"] != undefined || bodyPayload["gaslimit"] != "") {
                    sendergaslimit = bodyPayload["gaslimit"];
                }
                let SignedTxToSubmit = await signTx(senderEmail, receiverAddress, nonce, sendergasprice, sendergaslimit, amountToSend, "0x00");
                let transactionHash = await web3.eth.sendSignedTransaction(SignedTxToSubmit);
                resValue = { "TransactionHash": transactionHash };
                break;
            case '/buyethers':
                bodyPayload = JSON.parse(event.body);
                let buyerEmail = bodyPayload["email"];
                let buyEthAmount = bodyPayload["ethamount"];
                let txgasprice = 20000000000;
                let txgaslimit = 5000000;

                if (bodyPayload["gasprice"] != null || bodyPayload["gasprice"] != undefined || bodyPayload["gasprice"] != "") {
                    txgasprice = bodyPayload["gasprice"];
                }
                if (bodyPayload["gaslimit"] != null || bodyPayload["gaslimit"] != undefined || bodyPayload["gaslimit"] != "") {
                    txgaslimit = bodyPayload["gaslimit"];
                }
                resValue = await sendEthersFromAdminAccount(buyerEmail, buyEthAmount, txgasprice, txgaslimit);
                break;
            case '/getEthAddress':
                bodyPayload = JSON.parse(event.body);
                let emailToGet = bodyPayload["email"];
                resValue = await walletsvc.getEthAddressFromDB(emailToGet);
                break;
            case '/buystablecoin':
                break;
            case '/sendcoins':
                break
            default:
                resValue = { "Error": `Invalid Url: ${JSON.stringify(event.rawPath)}` };
        }
        return {
            "status": 200,
            "responseContent": resValue
        };

    }
    catch (e) {
        return {
            "status": 500,
            "responseContent": JSON.stringify(e)
        };
    }
};