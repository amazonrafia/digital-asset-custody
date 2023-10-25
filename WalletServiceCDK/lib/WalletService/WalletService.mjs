import { DynamoDBClient, PutItemCommand, GetItemCommand, ScanCommand, ExecuteStatementCommand } from "@aws-sdk/client-dynamodb";
import {KMSClient,CreateKeyCommand,CreateAliasCommand,GetPublicKeyCommand,SignCommand} from '@aws-sdk/client-kms';
import asn1 from 'asn1.js';
import keccak256 from 'keccak256';
import * as ethutil from 'ethereumjs-util';
import * as bn from 'bn.js';
import { Transaction} from 'ethereumjs-tx';

export default class WalletService{
    constructor() {
        this.dbTable = process.env.DYNAMODB_NAME;
        this.kmsclient = new KMSClient({region: "us-east-1"});
        this.dbclient=new DynamoDBClient({region: "us-east-1"});
        this.EcdsaPubKey=asn1.define('EcdsaPubKey', function(){
            this.seq().obj( 
                this.key('algo').seq().obj(
                    this.key('a').objid(),
                    this.key('b').objid(),
                ),
                this.key('pubKey').bitstr()
            );
        });
        this.EcdsaSigAsnParse = asn1.define('EcdsaSig', function() {
            this.seq().obj( 
                this.key('r').int(), 
                this.key('s').int(),
            );
        });
    }
    async getPublicKey(KMSId) {
        let kmsinputData = {
            KeyId:KMSId
        };
        let kmscommand = new GetPublicKeyCommand(kmsinputData);   
        let response = await this.kmsclient.send(kmscommand);    
        return response;
    }
    async getKMSIdFromDB(email){
        let dbclient=new DynamoDBClient({region: "us-east-1"});
        let dbinputData={
            "TableName": this.dbTable,
            "Key": { "UserEmail": {"S": email} }
        };
        let dbcommand = new GetItemCommand(dbinputData);
        let response = await dbclient.send(dbcommand);
        return response.Item.KeyID.S;
    }
    async getEthAddressFromDB(email){
        //from db get the email ethereum account so nonce can be calculated
        let dbclient=new DynamoDBClient({region: "us-east-1"});
        let dbinputData={
            "TableName": this.dbTable,
            "Key": { "UserEmail": {"S": email} }
        };
        let dbcommand = new GetItemCommand(dbinputData);
        let response = await dbclient.send(dbcommand);
        return response.Item.EthAddress.S;
    }
    
    getEthereumAddress(publicKey) {
        let res = this.EcdsaPubKey.decode(publicKey, 'der');
        let pubKeyBuffer  = res.pubKey.data;
        pubKeyBuffer = pubKeyBuffer.slice(1, pubKeyBuffer.length);
        const buf2 = keccak256(pubKeyBuffer) // keccak256 hash of publicKey  
        const EthAddr = "0x" + buf2.slice(-20).toString('hex'); // take last 20 bytes as ethereum adress
        //console.log("Generated Ethreum address: " + EthAddr);
        return EthAddr;
    }   
    recoverPubKeyFromSig(msg, r, s, v) {
        //console.log("Recovering public key with msg " + msg.toString('hex') + " r: " + r.toString(16) + " s: " + s.toString(16));
        let rBuffer = r.toBuffer();
        let sBuffer = s.toBuffer();
        let pubKey = ethutil.ecrecover(msg, v, rBuffer, sBuffer);
        let addrBuf = ethutil.pubToAddress(pubKey);
        var RecoveredEthAddr = ethutil.bufferToHex(addrBuf);
        //console.log( "Recovered ethereum address: " +  RecoveredEthAddr);
        return RecoveredEthAddr;
    }
    findRightKey(msg, r, s, expectedEthAddr) {
        let v = 27;
        let pubKey = this.recoverPubKeyFromSig(msg, r, s, v);
        if (pubKey != expectedEthAddr) {
            v = 28;
            pubKey = this.recoverPubKeyFromSig(msg, r, s, v)
        }
        //console.log("Found the right ETH Address: " + pubKey + " v: " + v);
        return { pubKey, v };
    }
    
    async sign(msgHash, keyId) {
        let kmsinputData = {
            KeyId:keyId,
            Message:msgHash,
            SigningAlgorithm:'ECDSA_SHA_256',
            MessageType:'DIGEST'
        };
        let kmscommand = new SignCommand(kmsinputData);
        let response = await this.kmsclient.send(kmscommand);   
        return response;
    }
    async findEthereumSig(plaintext,keyId) {
        let signature = await this.sign(plaintext, keyId);
        //console.log(signature);
        if (signature.Signature == undefined) {
            throw new Error('Signature is undefined.');
        }
        let bufferSignature=Buffer.from(signature.Signature)
        //console.log("encoded sig: " + bufferSignature.toString('hex'));
        let decoded = this.EcdsaSigAsnParse.decode(bufferSignature, 'der');
        let r = decoded.r;
        let s = decoded.s;
        
        //console.log("r: " + r.toString(10));
        //console.log("s: " + s.toString(10));
        
        let tempsig = r.toString(16) + s.toString(16);
        
        
        let secp256k1N = new bn.BN("fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141", 16); // max value on the curve
        let secp256k1halfN = secp256k1N.div(new bn.BN(2)); // half of the curve
        if (s.gt(secp256k1halfN)) {
            //console.log("s is on the wrong side of the curve... flipping - tempsig: " + tempsig + " length: " + tempsig.length);
            s = secp256k1N.sub(s);
            //console.log("new s: " + s.toString(10));
            return { r, s }
        }
        return { r, s };
    }
    
    async createWallet(emailAddress,keyAlias){
        try {
            let kmsinputData = {
                Description:`Wallet Key associated with email: ${emailAddress}`,
                KeyUsage:"SIGN_VERIFY",
                KeySpec:"ECC_SECG_P256K1",
                Origin:'AWS_KMS'
            };
            let kmscommand = new CreateKeyCommand(kmsinputData);
            let response = await this.kmsclient.send(kmscommand);
            let keyID=response.KeyMetadata.KeyId;
            
            let kmsAliasinputData = { 
                AliasName: 'alias/' + keyAlias,
                TargetKeyId: keyID
            };
            let aliascommand = new CreateAliasCommand(kmsAliasinputData);
            response = await this.kmsclient.send(aliascommand);
            
            //get ethereum public address
            let kmsPubKey=await this.getPublicKey(keyID);
            let ethAddress=this.getEthereumAddress(Buffer.from(kmsPubKey.PublicKey));
            
            //save in db
            let dbinputData={
                TableName: this.dbTable,
                Item: {
                    "UserEmail": { S: emailAddress },
                    "KeyID": { S: keyID },
                    "KeyAlias": { S: keyAlias },
                    "EthAddress": { S: ethAddress }
                }
            }
            const dbcommand = new PutItemCommand(dbinputData);
            response = await this.dbclient.send(dbcommand);
            return { 'status': 'Success', 'Msg': `A new wallet for ${emailAddress} is created and a its Ethereum address is stored in the DB` };
        }
        catch (e) {
            console.log(e);
            return { 'status': 'Failure', 'Msg': e };
        }
        
    }
    async createSignTransaction(fromaccountEmail,toAddress,nonce, gasPrice,gasLimit,value,data){
        let keyId=await this.getKMSIdFromDB(fromaccountEmail);
        let ethAddr = await this.getEthAddressFromDB(fromaccountEmail);
        let ethAddrHash = ethutil.keccak(Buffer.from(ethAddr));
        let sig = await this.findEthereumSig(ethAddrHash,keyId);
        let recoveredPubAddr = this.findRightKey(ethAddrHash, sig.r, sig.s, ethAddr);
        let txParams = {
            nonce: new bn.BN(nonce),
            gasPrice: gasPrice,
            gasLimit: gasLimit,
            to: toAddress,
            value: value,
            data: data,
            r: sig.r.toBuffer(),
            s: sig.s.toBuffer(),
            v: recoveredPubAddr.v
        };
       
        let tx = new Transaction(txParams);
        let txHash = tx.hash(false);
        sig = await this.findEthereumSig(txHash,keyId);
        recoveredPubAddr = this.findRightKey(txHash, sig.r, sig.s, ethAddr);
        tx.r = sig.r.toBuffer();
        tx.s = sig.s.toBuffer();
        tx.v = new bn.BN(recoveredPubAddr.v).toBuffer();
        let serializedTx = '0x' + tx.serialize().toString('hex'); 
        return serializedTx;
    }
}