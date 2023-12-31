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
            
            if(process.env.NETWORK_ENDPOINT==undefined || process.env.NETWORK_ENDPOINT==""){
                secretValue = await fetch(`http://localhost:2773/secretsmanager/get?secretId=${encodeURIComponent("GoerliAccess")}`, { headers: { 'X-Aws-Parameters-Secrets-Token': process.env.AWS_SESSION_TOKEN, 'Content-Type': 'application/json' } });
                jsonTxt = await secretValue.json();
                let networkEndpoint=JSON.parse(jsonTxt.SecretString)["ambtbaurl"];
                web3= new Web3(new Web3.providers.HttpProvider(networkEndpoint));
            }
            else{
                web3= new Web3(new Web3.providers.HttpProvider(process.env.NETWORK_ENDPOINT))
            }
            adminWallet = web3.eth.accounts.wallet.add(adminPrivateKey);
            
        }
        catch (e) {
            console.log('error occurred in get setret from secret manager');
            throw e;
        }
    }
}
let signTx = async (FromAccountEmail, ToAddress, nonce, gasPrice, gasLimit, value, data) => {
    try{
        let signedTx = await walletsvc.createSignTransaction(FromAccountEmail, ToAddress, nonce, gasPrice, gasLimit, value, data);
        return signedTx;
    }
    catch (e) {
        console.log(`error occured in lambdSigleton: ${e}`);
        throw e;
    }
}
let sendEthersFromAdminAccount = async (email, ethAmount, TxGasPrice, TxGasLimit) => {

    let account = adminWallet;
    let toAddress = await walletsvc.getEthAddressFromDB(email);
    try {
        let receipt = await web3.eth.sendTransaction({
            from: account.address,
            to: toAddress,
            value: ethAmount,
            gasPrice: TxGasPrice,
            gasLimit: TxGasLimit,
            // other transaction's params
        });
        return { 'status': 'Success', 'Transaction Receipt': receipt };
    }
    catch (error) {
        console.log(`Error in sendEthersFromAdminAccount: ${error}`);
        throw error;
    }

}
let sendCoinFromAdminAccount=async(email,coinAmount,TxGasPrice,TxGasLimit)=>{
    let account = adminWallet;
    let toAddress = await walletsvc.getEthAddressFromDB(email);
    try {
        let receipt = await web3.eth.sendTransaction({
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
        console.log(`Error in sendCoinFromAdminAccount: ${error}`);
        throw error
    }
}
let getCoinTransferData = (toEthAddress, coinValue) => {
    try{
        let returnData = "";
        let encodingStrs = [];
        encodingStrs.push(web3.eth.abi.encodeFunctionSignature("transfer(address,uint256)"));
        encodingStrs.push(web3.eth.abi.encodeParameter('address', toEthAddress));
        encodingStrs.push(web3.eth.abi.encodeParameter('uint256', coinValue));
    
    
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
    catch (error) {
        console.log(`Error in getCoinTransferData: ${error}`);
        throw error;
    }
}

let getCoinBalance=async (ethAccount)=>{
    let balanceOfABI=[
        {
            "inputs": [
              {
                "internalType": "address",
                "name": "account",
                "type": "address"
              }
            ],
            "name": "balanceOf",
            "outputs": [
              {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
              }
            ],
            "stateMutability": "view",
            "type": "function"
          }
    ];
    
    let tokenAddress = process.env.COIN_CONTRACT_ADDRESS;
    let tokenContract = new web3.eth.Contract(balanceOfABI, tokenAddress);
    let result = await tokenContract.methods.balanceOf(ethAccount).call({ from: adminWallet.address, gasPrice: '20000000000', gas: 5000000 });
    console.log(`Balance of coin: ${result}`);
    return `Balance of coin: ${result}`;
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
                requestEmail = bodyPayload["email"].toLowerCase();
                let kmdAliasStr=requestEmail.replaceAll("@", "_").replaceAll(".", "_");
                //first check if this email exists in db
                let verifyEmail=await walletsvc.getEthAddressFromDB(requestEmail);
                if(verifyEmail==""){
                    resValue = await walletsvc.createWallet(requestEmail, kmdAliasStr);
                }
                else{
                    resValue = "Key with this email already exists"
                }
                break;
            case '/signTx':
                bodyPayload = JSON.parse(event.body);
                let SignedTransaction = await signTx(bodyPayload["email"].toLowerCase(), bodyPayload["ToEthAccount"], bodyPayload["nonce"], bodyPayload["gasPrice"], bodyPayload["gasLimit"], bodyPayload["TxValue"], bodyPayload["TxData"]);
                resValue = { "SignedTx": SignedTransaction };
                break;
            case '/signandsubmit':
                bodyPayload = JSON.parse(event.body);
                let TxToSubmit = await signTx(bodyPayload["email"].toLowerCase(), bodyPayload["ToEthAccount"], bodyPayload["nonce"], bodyPayload["gasPrice"], bodyPayload["gasLimit"], bodyPayload["TxValue"], bodyPayload["TxData"]);
                let submittedTxHash = await web3.eth.sendSignedTransaction(TxToSubmit);
                resValue = { "TransactionHash": submittedTxHash };
                break;
            case '/sendethers':
                bodyPayload = JSON.parse(event.body);
                requestEmail = bodyPayload["email"].toLowerCase();
                receiverAddress = bodyPayload["ToEthAccount"];
                let amountToSend = bodyPayload["amount"];
                let ethSenderAddress = await walletsvc.getEthAddressFromDB(requestEmail);
                let sendEthnonce = await web3.eth.getTransactionCount(ethSenderAddress);
                txgasprice = 20000000000;
                txgaslimit = 5000000;
                if (bodyPayload["gasprice"] != null && bodyPayload["gasprice"] != undefined && bodyPayload["gasprice"] != "") {
                    txgasprice = bodyPayload["gasprice"];
                }
                if (bodyPayload["gaslimit"] != null && bodyPayload["gaslimit"] != undefined && bodyPayload["gaslimit"] != "") {
                    txgaslimit = bodyPayload["gaslimit"];
                }
                let SignedEthTxToSubmit = await signTx(requestEmail, receiverAddress, sendEthnonce, txgasprice, txgaslimit, amountToSend, "0x00");
                let ethTransactionHash = await web3.eth.sendSignedTransaction(SignedEthTxToSubmit);
                resValue = { "TransactionHash": ethTransactionHash };
                break;
            case '/buyethers':
                bodyPayload = JSON.parse(event.body);
                requestEmail = bodyPayload["email"].toLowerCase();
                let buyEthAmount = bodyPayload["ethamount"];
                txgasprice = 20000000000;
                txgaslimit = 5000000;

                if (bodyPayload["gasprice"] != null && bodyPayload["gasprice"] != undefined && bodyPayload["gasprice"] != "") {
                    txgasprice = bodyPayload["gasprice"];
                }
                if (bodyPayload["gaslimit"] != null && bodyPayload["gaslimit"] != undefined && bodyPayload["gaslimit"] != "") {
                    txgaslimit = bodyPayload["gaslimit"];
                }
                resValue = await sendEthersFromAdminAccount(requestEmail, buyEthAmount, txgasprice, txgaslimit);
                break;
            case '/getethAddress':
                bodyPayload = JSON.parse(event.body);
                requestEmail = bodyPayload["email"].toLowerCase();
                let ethAddress=await walletsvc.getEthAddressFromDB(requestEmail);
                resValue=`Ethereum Address for the email ${requestEmail} is: ${ethAddress}`;
                break;
            case '/buystablecoin':
                bodyPayload = JSON.parse(event.body);
                requestEmail = bodyPayload["email"].toLowerCase();
                let requestAmount=bodyPayload["dollaramount"];
                txgasprice = 20000000000;
                txgaslimit = 5000000;
                if (bodyPayload["gasprice"] != null && bodyPayload["gasprice"] != undefined && bodyPayload["gasprice"] != "") {
                    txgasprice = bodyPayload["gasprice"];
                }
                if (bodyPayload["gaslimit"] != null && bodyPayload["gaslimit"] != undefined && bodyPayload["gaslimit"] != "") {
                    txgaslimit = bodyPayload["gaslimit"];
                }
                //let numberOfCoin=Math.floor(requestAmount/10);
                resValue = await sendCoinFromAdminAccount(requestEmail, requestAmount, txgasprice, txgaslimit);
                break;
            case '/sendcoins':
                bodyPayload = JSON.parse(event.body);
                requestEmail = bodyPayload["email"].toLowerCase();
                receiverAddress = bodyPayload["ToEthAccount"];
                let coinToSend = bodyPayload["coincount"];
                let coinSenderAddress = await walletsvc.getEthAddressFromDB(requestEmail);
                let sendCoinNonce = await web3.eth.getTransactionCount(coinSenderAddress);
                txgasprice = 20000000000;
                txgaslimit = 5000000;
                if (bodyPayload["gasprice"] != null && bodyPayload["gasprice"] != undefined && bodyPayload["gasprice"] != "") {
                    txgasprice = bodyPayload["gasprice"];
                }
                if (bodyPayload["gaslimit"] != null && bodyPayload["gaslimit"] != undefined && bodyPayload["gaslimit"] != "") {
                    txgaslimit = bodyPayload["gaslimit"];
                }
                let SignedCoinTxToSubmit = await signTx(requestEmail, process.env.COIN_CONTRACT_ADDRESS, sendCoinNonce, txgasprice, txgaslimit, "0x00", getCoinTransferData(receiverAddress,coinToSend));
                try{
                    let coinTransactionHash = await web3.eth.sendSignedTransaction(SignedCoinTxToSubmit);
                    resValue = { "TransactionHash": coinTransactionHash };
                }
                catch(sendcoinError){
                    console.log(sendcoinError);
                    resValue = { "Error": sendcoinError };
                }
                break;
            case '/getethbalance':
                bodyPayload = JSON.parse(event.body);
                requestEmail = bodyPayload["email"].toLowerCase();
                let ethBalanceAddress = await walletsvc.getEthAddressFromDB(requestEmail);
                let ethBlanceInWei=await web3.eth.getBalance(ethBalanceAddress);
                resValue={ 'status': 'Success', 'Msg': `Ether balance for ${requestEmail} (in Wei) is: ${ethBlanceInWei}` };
                break;
            case '/getcoinbalance':
                bodyPayload = JSON.parse(event.body);
                requestEmail = bodyPayload["email"].toLowerCase();
                let coinBalanceAddress = await walletsvc.getEthAddressFromDB(requestEmail);
                resValue= await getCoinBalance(coinBalanceAddress);
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
        console.log(`Error in main handler: {e}`);
        return {
            "status": 500,
            "responseContent": JSON.stringify(e)
        };
    }
};