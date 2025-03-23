import { Given, Then, When } from "@cucumber/cucumber";
import {
  AccountBalanceQuery,
  AccountId,
  Client,
  KeyList,
  PrivateKey,
  RequestType,
  TopicCreateTransaction,
  TopicInfoQuery,
  TopicMessageQuery,
  TopicMessageSubmitTransaction,
} from "@hashgraph/sdk";
import { accounts } from "../../src/config";
import assert from "node:assert";
import ConsensusSubmitMessage = RequestType.ConsensusSubmitMessage;

// Pre-configured client for test network (testnet)
const client = Client.forTestnet();
Given(
  /^a first account with more than (\d+) hbars$/,
  async function (expectedBalance: number) {
    const acc = accounts[0];
    const account: AccountId = AccountId.fromString(acc.id);
    this.account = account;
    const privKey: PrivateKey = PrivateKey.fromStringED25519(acc.privateKey);
    this.privKey = privKey;
    client.setOperator(this.account, privKey);

    //Create the query request
    const query = new AccountBalanceQuery().setAccountId(account);
    const balance = await query.execute(client);
    assert.ok(balance.hbars.toBigNumber().toNumber() > expectedBalance);
  }
);

When(
  /^A topic is created with the memo "([^"]*)" with the first account as the submit key$/,
  async function (memo: string) {
    try {
      const topicCreateTx = await new TopicCreateTransaction()
        .setTopicMemo(memo)
        .setSubmitKey(this.privKey.publicKey)
        .setAdminKey(this.privKey.publicKey)
        .setAutoRenewAccountId(this.account)
        .setAutoRenewPeriod(7890000)
        .freezeWith(client);

      const topicCreateTxSigned = await topicCreateTx.sign(this.privKey);
      const topicCreateTxSubmitted = await topicCreateTxSigned.execute(client);
      const topicCreateTxReceipt = await topicCreateTxSubmitted.getReceipt(
        client
      );

      this.topicId = topicCreateTxReceipt.topicId;
    } catch (error) {
      console.error(`Error creating topic: ${error}`);
      throw error;
    }
  }
);

When(
  /^The message "([^"]*)" is published to the topic$/,
  async function (message: string) {
    try {
      const topicMsgSubmitTx = await new TopicMessageSubmitTransaction()
        .setTransactionMemo(message)
        .setTopicId(this.topicId)
        .setMessage(message)
        .freezeWith(client);
      const topicMsgSubmitTxId = topicMsgSubmitTx.transactionId;

      const topicMsgSubmitTxSigned = await topicMsgSubmitTx.sign(this.privKey);
      const topicMsgSubmitTxSubmitted = await topicMsgSubmitTxSigned.execute(
        client
      );

      // Get the transaction receipt
      const topicMsgSubmitTxReceipt =
        await topicMsgSubmitTxSubmitted.getReceipt(client);
      // Get the topic message sequence number
      const topicMsgSeqNum = topicMsgSubmitTxReceipt.topicSequenceNumber;
    } catch (error) {
      console.error(`Error creating topic: ${error}`);
      throw error;
    }
  }
);

Then(
  /^The message "([^"]*)" is received by the topic and can be printed to the console$/,
  { timeout: 5000 },
  async function (expectedMessage) {
    try {
      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(
            new Error(`Timed out waiting for message: ${expectedMessage}`)
          );
        }, 5000); // 30 second timeout

        const submitmsg = new TopicMessageQuery()
          .setTopicId(this.topicId)
          .setStartTime(0) // Start from the beginning to make sure we don't miss messages
          .subscribe(client, null, (message) => {
            let messageAsString = Buffer.from(message.contents).toString(
              "utf8"
            );
            if (messageAsString === expectedMessage) {
              clearTimeout(timeout);
              resolve();
            }
          });
      });
    } catch (error) {
      throw error;
    }
  }
);

Given(
  /^A second account with more than (\d+) hbars$/,
  async function (expectedBalance: number) {
    const acc = accounts[3];
    const account: AccountId = AccountId.fromString(acc.id);
    this.account = account;
    const privKey: PrivateKey = PrivateKey.fromStringED25519(acc.privateKey);
    this.privKey = privKey;
    client.setOperator(this.account, privKey);
    const secondPubKey = privKey.publicKey;

    //Create the query request
    const query = new AccountBalanceQuery().setAccountId(account);
    const balance = await query.execute(client);
    assert.ok(balance.hbars.toBigNumber().toNumber() > expectedBalance);
  }
);

Given(
  /^A (\d+) of (\d+) threshold key with the first and second account$/,
  async function (threshold, totalKeys) {
    const firstAcc = accounts[2];
    const firstAccountId = AccountId.fromString(firstAcc.id);
    const firstPrivKey = PrivateKey.fromStringED25519(firstAcc.privateKey);
    const firstPubKey = firstPrivKey.publicKey;

    // Get the second account's information
    const secondAcc = accounts[3];
    const secondAccountId = AccountId.fromString(secondAcc.id);
    const secondPrivKey = PrivateKey.fromStringED25519(secondAcc.privateKey);
    const secondPubKey = secondPrivKey.publicKey;

    // Create a key list with the threshold
    const publicKeyList = [firstPubKey, secondPubKey];
    const thresholdKey = new KeyList(publicKeyList, parseInt(threshold));
    // Store the threshold key and private keys for later use in your test
    this.thresholdKey = thresholdKey;
    this.privateKeys = [firstPrivKey, secondPrivKey];
  }
);

When(
  /^A topic is created with the memo "([^"]*)" with the threshold key as the submit key$/,
  async function (memo) {
    // Assuming this.thresholdKey was created in a previous step
    if (!this.thresholdKey) {
      throw new Error(
        "Threshold key not found. Please create a threshold key first."
      );
    }

    try {
      // Create a new topic with the threshold key as the submit key
      const transaction = await new TopicCreateTransaction()
        .setTopicMemo(memo)
        .setSubmitKey(this.thresholdKey)
        .setAdminKey(this.privateKeys[0])
        .freezeWith(client);
      const signedTx = await transaction.sign(this.privateKeys[0]);
      if (this.thresholdKey.threshold > 1) {
        await signedTx.sign(this.privateKeys[1]);
      }

      // Execute the transaction
      const txResponse = await signedTx.execute(client);

      // Get the receipt
      const receipt = await txResponse.getReceipt(client);

      // Store the topic ID for later use
      this.topicId = receipt.topicId;
    } catch (error) {
      console.error(`Error creating topic: ${error}`);
      throw error;
    }
  }
);
