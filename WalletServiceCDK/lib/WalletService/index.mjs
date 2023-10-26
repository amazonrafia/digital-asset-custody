import Web3 from 'web3';
import WalletService from './WalletService.mjs'

/*global fetch*/

let walletsvc = new WalletService();
let web3;
let adminPrivateKey = "";
let adminWallet;
let txgasprice;
let txgaslimit;
let receiverAddress;

//lambda Singleton object
let lambdaSingleton = async () => {
    if (adminPrivateKey == "") {
        try {
            let secretValue = await fetch(`http://localhost:2773/secretsmanager/get?secretId=${encodeURIComponent(process.env.SECRET_MGR_STR)}`, { headers: { 'X-Aws-Parameters-Secrets-Token': process.env.AWS_SESSION_TOKEN, 'Content-Type': 'application/json' } });
            let jsonTxt = await secretValue.json();
            adminPrivateKey = JSON.parse(jsonTxt.SecretString)["privatekey"];
            adminWallet = web3.eth.accounts.wallet.add(adminPrivateKey);

            if(process.env.NETWORK_ENDPOINT==undefined || process.env.NETWORK_ENDPOINT==""){
                secretValue = await fetch(`http://localhost:2773/secretsmanager/get?secretId=${encodeURIComponent("GoerliAccess")}`, { headers: { 'X-Aws-Parameters-Secrets-Token': process.env.AWS_SESSION_TOKEN, 'Content-Type': 'application/json' } });
                jsonTxt = await secretValue.json();
                let networkEndpoint=JSON.parse(jsonTxt.SecretString)["ambtbaurl"];
                web3= new Web3(new Web3.providers.HttpProvider(networkEndpoint));
            }
            else{
                web3= new Web3(new Web3.providers.HttpProvider(process.env.NETWORK_ENDPOINT))
            }
            
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
let sendCoinFromAdminAccount=async(email,coinAmount,TxGasPrice,TxGasLimit)=>{
    let account = adminWallet;
    let toAddress = await walletsvc.getEthAddressFromDB(email);
    try {
        let receipt = await this.web3.eth.sendTransaction({
            from: account.address,
            to: process.env.COIN_CONTRACT_ADDRESS,
            value: "0x00",
            gasPrice: TxGasPrice,
            gasLimit: TxGasLimit,
            data:getCoinTransferData(toAddress,coinAmount)
            // other transaction's params
        });
        return { 'status': 'Success', 'Transaction Receipt': receipt };
    }
    catch (error) {
        console.log(error);
    }
}
let callContractFunction=async(data,TxGasPrice,TxGasLimit)=>{
    let account = adminWallet;
    try {
        let receipt = await this.web3.eth.sendTransaction({
            from: account.address,
            to: process.env.COIN_CONTRACT_ADDRESS,
            value: "0x00",
            gasPrice: TxGasPrice,
            gasLimit: TxGasLimit,
            data:data
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
let getCoinBalanceData=(toEthAddress)=>{
    //balanceOf(address account) → uint256
    let returnData = "";
    let encodingStrs = [];
    encodingStrs.push(this.web3.eth.abi.encodeFunctionSignature("balanceOf(address)"));
    encodingStrs.push(this.web3.eth.abi.encodeParameter('address', toEthAddress));
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
    let requestEmail;
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
                requestEmail = bodyPayload["email"].replaceAll("@", "_").replaceAll(".", "_");
                resValue = await walletsvc.createWallet(bodyPayload["email"], requestEmail);
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
                resValue = { "TransactionHash": submittedTxHash };
                break;
            case '/sendethers':
                bodyPayload = JSON.parse(event.body);
                requestEmail = bodyPayload["email"];
                receiverAddress = bodyPayload["ToEthAccount"];
                let amountToSend = bodyPayload["amount"] * 1000000000000000000;
                let ethSenderAddress = await walletsvc.getEthAddressFromDB(requestEmail);
                let sendEthnonce = await web3.eth.getTransactionCount(ethSenderAddress);
                txgasprice = 20000000000;
                txgaslimit = 5000000;
                if (bodyPayload["gasprice"] != null || bodyPayload["gasprice"] != undefined || bodyPayload["gasprice"] != "") {
                    txgasprice = bodyPayload["gasprice"];
                }
                if (bodyPayload["gaslimit"] != null || bodyPayload["gaslimit"] != undefined || bodyPayload["gaslimit"] != "") {
                    txgaslimit = bodyPayload["gaslimit"];
                }
                let SignedEthTxToSubmit = await signTx(requestEmail, receiverAddress, sendEthnonce, txgasprice, txgaslimit, amountToSend, "0x00");
                let ethTransactionHash = await web3.eth.sendSignedTransaction(SignedEthTxToSubmit);
                resValue = { "TransactionHash": ethTransactionHash };
                break;
            case '/buyethers':
                bodyPayload = JSON.parse(event.body);
                requestEmail = bodyPayload["email"];
                let buyEthAmount = bodyPayload["ethamount"];
                txgasprice = 20000000000;
                txgaslimit = 5000000;

                if (bodyPayload["gasprice"] != null || bodyPayload["gasprice"] != undefined || bodyPayload["gasprice"] != "") {
                    txgasprice = bodyPayload["gasprice"];
                }
                if (bodyPayload["gaslimit"] != null || bodyPayload["gaslimit"] != undefined || bodyPayload["gaslimit"] != "") {
                    txgaslimit = bodyPayload["gaslimit"];
                }
                resValue = await sendEthersFromAdminAccount(requestEmail, buyEthAmount, txgasprice, txgaslimit);
                break;
            case '/getethAddress':
                bodyPayload = JSON.parse(event.body);
                requestEmail = bodyPayload["email"];
                resValue = await walletsvc.getEthAddressFromDB(requestEmail);
                break;
            case '/buystablecoin':
                bodyPayload = JSON.parse(event.body);
                requestEmail = bodyPayload["email"];
                let requestAmount=bodyPayload["dollaramount"];
                txgasprice = 20000000000;
                txgaslimit = 5000000;
                if (bodyPayload["gasprice"] != null || bodyPayload["gasprice"] != undefined || bodyPayload["gasprice"] != "") {
                    txgasprice = bodyPayload["gasprice"];
                }
                if (bodyPayload["gaslimit"] != null || bodyPayload["gaslimit"] != undefined || bodyPayload["gaslimit"] != "") {
                    txgaslimit = bodyPayload["gaslimit"];
                }
                let numberOfCoin=Math.floor(requestAmount/10);
                resValue = await sendCoinFromAdminAccount(requestEmail, numberOfCoin, txgasprice, txgaslimit);
                break;
            case '/sendcoins':
                bodyPayload = JSON.parse(event.body);
                requestEmail = bodyPayload["email"];
                receiverAddress = bodyPayload["ToEthAccount"];
                let coinToSend = bodyPayload["coincount"];
                let coinSenderAddress = await walletsvc.getEthAddressFromDB(requestEmail);
                let sendCoinNonce = await web3.eth.getTransactionCount(coinSenderAddress);
                txgasprice = 20000000000;
                txgaslimit = 5000000;
                if (bodyPayload["gasprice"] != null || bodyPayload["gasprice"] != undefined || bodyPayload["gasprice"] != "") {
                    txgasprice = bodyPayload["gasprice"];
                }
                if (bodyPayload["gaslimit"] != null || bodyPayload["gaslimit"] != undefined || bodyPayload["gaslimit"] != "") {
                    txgaslimit = bodyPayload["gaslimit"];
                }
                let SignedCoinTxToSubmit = await signTx(requestEmail, process.env.COIN_CONTRACT_ADDRESS, sendCoinNonce, txgasprice, txgaslimit, "0x00", getCoinTransferData(receiverAddress,coinToSend));
                let coinTransactionHash = await web3.eth.sendSignedTransaction(SignedCoinTxToSubmit);
                resValue = { "TransactionHash": coinTransactionHash };
                break;
            case '/getethbalance':
                bodyPayload = JSON.parse(event.body);
                requestEmail = bodyPayload["email"];
                let ethBalanceAddress = await walletsvc.getEthAddressFromDB(requestEmail);
                let ethBlanceInWei=await web3.eth.getBalance(ethBalanceAddress);
                resValue={ 'status': 'Success', 'Msg': `Ether balance for ${requestEmail} (in Wei) is: ${ethBlanceInWei}` };
                break;
            case '/getcoinbalance':
                bodyPayload = JSON.parse(event.body);
                requestEmail = bodyPayload["email"];
                let coinBalanceAddress = await walletsvc.getEthAddressFromDB(requestEmail);
                txgasprice = 20000000000;
                txgaslimit = 5000000;
                if (bodyPayload["gasprice"] != null || bodyPayload["gasprice"] != undefined || bodyPayload["gasprice"] != "") {
                    txgasprice = bodyPayload["gasprice"];
                }
                if (bodyPayload["gaslimit"] != null || bodyPayload["gaslimit"] != undefined || bodyPayload["gaslimit"] != "") {
                    txgaslimit = bodyPayload["gaslimit"];
                }
                let coinBlance=await callContractFunction(getCoinBalanceData(coinBalanceAddress),txgasprice,txgaslimit);
                resValue={ 'status': 'Success', 'Msg': `Coin balance for ${requestEmail} is: ${coinBlance}` };
                break;
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