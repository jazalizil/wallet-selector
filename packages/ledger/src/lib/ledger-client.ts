import type { DeviceManagementKit } from "@ledgerhq/device-management-kit";
import {
  DeviceActionStatus,
  DeviceManagementKitBuilder,
} from "@ledgerhq/device-management-kit";

import type {
  HardwareWallet,
  WalletBehaviourOptions,
} from "@near-wallet-selector/core";
import { firstValueFrom, lastValueFrom } from "rxjs";
import type * as nearAPI from "near-api-js";

import { webHidTransportFactory } from "@hanja-tech/ledger-device-transport-kit-web-hid";

import { webBleTransportFactory } from "@hanja-tech/ledger-device-transport-kit-web-ble";

import {
  type SignerNear,
  SignerNearBuilder,
} from "@hanja-tech/ledger-signer-near";

interface GetPublicKeyParams {
  derivationPath: string;
  checkOnDevice?: boolean;
}

interface SignParams {
  signerId: string;
  receiverId: string;
  actions: Array<nearAPI.transactions.Action>;
  derivationPath: string;
}

interface SignMessageParams {
  derivationPath: string;
  message: string;
  recipient: string;
  nonce: Uint8Array;
  callbackUrl?: string;
}

interface SignDelegateParams {
  derivationPath: string;
  maxBlockHeight: bigint;
  nonce: bigint;
  actions: Array<nearAPI.transactions.Action>;
  senderId: string;
  receiverId: string;
}

export interface Subscription {
  remove: () => void;
}

export class LedgerClient {
  private dmk: DeviceManagementKit;

  private sessionId = "";
  private ledgerSigner: SignerNear | null = null;

  constructor(logger: WalletBehaviourOptions<HardwareWallet>["logger"]) {
    this.dmk = new DeviceManagementKitBuilder()
      .addTransport(webHidTransportFactory)
      .addTransport(webBleTransportFactory)
      .addLogger(logger)
      .build();
  }

  isConnected = () => {
    try {
      this.dmk.getConnectedDevice({ sessionId: this.sessionId });
      return true;
    } catch (e) {
      return false;
    }
  };

  connect = async (transport: string) => {
    this.sessionId = await this.dmk.connect({
      device: await firstValueFrom(this.dmk.startDiscovering({ transport })),
    });
    this.ledgerSigner = new SignerNearBuilder({
      dmk: this.dmk,
      sessionId: this.sessionId,
    }).build();
  };

  disconnect = async () => {
    this.dmk.disconnect({ sessionId: this.sessionId });
  };

  getVersion = async () => {
    if (!this.ledgerSigner) {
      throw new Error("Device not connected");
    }

    const getVersionResult = await lastValueFrom(
      this.ledgerSigner.getVersion({}).observable
    );

    if (getVersionResult.status === DeviceActionStatus.Completed) {
      return getVersionResult.output.version;
    } else if (getVersionResult.status === DeviceActionStatus.Error) {
      throw getVersionResult.error;
    }
    return "";
  };

  getPublicKey = async ({
    derivationPath,
    checkOnDevice = true,
  }: GetPublicKeyParams) => {
    if (!this.ledgerSigner) {
      throw new Error("Device not connected");
    }
    const pubKeyResult = await lastValueFrom(
      this.ledgerSigner.getPublicKey(derivationPath, { checkOnDevice })
        .observable
    );

    if (pubKeyResult.status === DeviceActionStatus.Completed) {
      console.log("get poub key in client::", pubKeyResult.output);
      return pubKeyResult.output;
    } else if (pubKeyResult.status === DeviceActionStatus.Error) {
      throw pubKeyResult.error;
    }
    return "";
  };

  signTransaction = async ({
    derivationPath,
    signerId,
    receiverId,
    actions,
  }: SignParams) => {
    if (!this.ledgerSigner) {
      throw new Error("Device not connected");
    }
    const signTransactionDAResult = await lastValueFrom(
      this.ledgerSigner.signTransaction(derivationPath, {
        signerId,
        receiverId,
        actions,
        nonce: BigInt(0),
        blockHash: Uint8Array.from(new Array(32).fill(0)),
      }).observable
    );
    if (signTransactionDAResult.status === DeviceActionStatus.Completed) {
      return Buffer.from(signTransactionDAResult.output);
    } else if (signTransactionDAResult.status === DeviceActionStatus.Error) {
      throw signTransactionDAResult.error;
    }
    return Buffer.from([]);
  };

  signMessage = async ({
    message,
    recipient,
    nonce,
    callbackUrl,
    derivationPath,
  }: SignMessageParams) => {
    if (!this.ledgerSigner) {
      throw new Error("Device not connected");
    }
    const signTransactionDAResult = await lastValueFrom(
      this.ledgerSigner.signMessage(derivationPath, {
        message,
        recipient,
        nonce,
        callbackUrl,
      }).observable
    );
    if (signTransactionDAResult.status === DeviceActionStatus.Completed) {
      return signTransactionDAResult.output;
    } else if (signTransactionDAResult.status === DeviceActionStatus.Error) {
      throw signTransactionDAResult.error;
    }
    return Uint8Array.from([]);
  };

  signDelegateAction = async ({
    senderId,
    actions,
    maxBlockHeight,
    nonce,
    receiverId,
    derivationPath,
  }: SignDelegateParams) => {
    if (!this.ledgerSigner) {
      throw new Error("Device not connected");
    }
    const signTransactionDAResult = await lastValueFrom(
      this.ledgerSigner.signDelegate(derivationPath, {
        senderId,
        receiverId,
        actions,
        nonce,
        maxBlockHeight,
      }).observable
    );
    if (signTransactionDAResult.status === DeviceActionStatus.Completed) {
      return Buffer.from(signTransactionDAResult.output);
    } else if (signTransactionDAResult.status === DeviceActionStatus.Error) {
      throw signTransactionDAResult.error;
    }
    return Buffer.from([]);
  };
}
