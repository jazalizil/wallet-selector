import { isMobile } from "is-mobile";
import { signTransactions } from "@near-wallet-selector/wallet-utils";
import type {
  Account,
  HardwareWallet,
  JsonStorageService,
  Optional,
  SignedMessage,
  SignMessageParams,
  Transaction as WalletTransaction,
  WalletBehaviourFactory,
  WalletBehaviourOptions,
  WalletModuleFactory,
} from "@near-wallet-selector/core";
import {
  getActiveAccount,
  verifyFullKeyBelongsToUser,
  verifySignature,
} from "@near-wallet-selector/core";
import type {
  DelegateAction,
  Transaction as NearTransaction,
} from "@near-js/transactions";
import { SignedDelegate, SignedTransaction } from "@near-js/transactions";

import type { Subscription } from "./ledger-client";
import { LedgerClient } from "./ledger-client";
import * as nearAPI from "near-api-js";
import type {
  FinalExecutionOutcome,
  JsonRpcProvider,
} from "near-api-js/lib/providers/index.js";
import icon from "./icon";
import { webHidIdentifier } from "@hanja-tech/ledger-device-transport-kit-web-hid";
import { deserialize, serialize } from "borsh";
import { near } from "viem/chains";
import { ProviderService } from "@near-wallet-selector/core/src/lib/services";
import type { AccessKeyView } from "near-api-js/lib/providers/provider";

interface LedgerAccount extends Account {
  derivationPath: string;
  publicKey: string;
}

interface ValidateAccessKeyParams {
  accountId: string;
  publicKey: string;
}

interface LedgerState {
  client: LedgerClient;
  accounts: Array<LedgerAccount>;
  subscriptions: Array<Subscription>;
}

export interface LedgerParams {
  iconUrl?: string;
  deprecated?: boolean;
  transport?: string;
}

export const STORAGE_ACCOUNTS = "accounts";

const setupLedgerState = async (
  storage: JsonStorageService,
  logger: WalletBehaviourOptions<HardwareWallet>["logger"]
): Promise<LedgerState> => {
  const accounts = await storage.getItem<Array<LedgerAccount>>(
    STORAGE_ACCOUNTS
  );

  return {
    client: new LedgerClient(logger),
    subscriptions: [],
    accounts: accounts || [],
  };
};

type LedgerHardwareWallet = HardwareWallet & {
  metadata: HardwareWallet["metadata"] & {
    transport: string;
  };
};

class LedgerSigner extends nearAPI.Signer {
  constructor(
    private ledgerState: LedgerState,
    private store: WalletBehaviourOptions<HardwareWallet>["store"]
  ) {
    super();
  }
  createKey(): Promise<nearAPI.utils.PublicKey> {
    throw new Error("Method not implemented.");
  }
  private _getDerivationPath() {
    const activeAccount = this.store
      .getState()
      .accounts.find((ac) => ac.active);
    if (!activeAccount) {
      throw new Error("Failed to find derivation path for active account");
    }
    const ledgerAccount = this.ledgerState.accounts.find(
      (ac) => ac.accountId === activeAccount.accountId
    );
    if (!ledgerAccount) {
      throw new Error("Failed to find derivation path for active account");
    }
    return ledgerAccount.derivationPath;
  }
  async signMessage(transaction: Uint8Array) {
    const derivationPath = this._getDerivationPath();
    console.log("START sign message", transaction);
    const { publicKey, ...tx } = deserialize(
      nearAPI.transactions.SCHEMA.Transaction,
      transaction
    ) as NearTransaction;
    const signature = await this.ledgerState.client.signTransaction({
      ...tx,
      derivationPath,
    });
    console.log("sign message result::", publicKey.toString());
    return {
      accountId: this.ledgerState.accounts[0].accountId,
      publicKey: publicKey,
      signature: signature,
    };
  }
  async getPublicKey(signerId?: string): Promise<nearAPI.utils.PublicKey> {
    const derivationPath = this._getDerivationPath();
    const ledgerPubKey = await this.ledgerState.client.getPublicKey({
      derivationPath,
      checkOnDevice: !signerId,
    });
    return nearAPI.utils.PublicKey.from(ledgerPubKey);
  }

  async signDelegateAction(
    delegateAction: DelegateAction
  ): Promise<[Uint8Array, SignedDelegate]> {
    const derivationPath = this._getDerivationPath();
    const signature = await this.ledgerState.client.signDelegateAction({
      senderId: delegateAction.senderId,
      receiverId: delegateAction.receiverId,
      actions: delegateAction.actions,
      nonce: delegateAction.nonce,
      maxBlockHeight: delegateAction.maxBlockHeight,
      derivationPath,
    });
    return Promise.resolve([
      signature,
      new SignedDelegate({
        delegateAction,
        signature: new nearAPI.transactions.Signature({
          data: signature,
          keyType: nearAPI.utils.key_pair.KeyType.ED25519,
        }),
      }),
    ]);
  }

  async signNep413Message(
    message: string,
    accountId: string,
    recipient: string,
    nonce: Uint8Array,
    callbackUrl?: string
  ): ReturnType<nearAPI.Signer["signNep413Message"]> {
    const derivationPath = this._getDerivationPath();
    const signature = await this.ledgerState.client.signMessage({
      message,
      nonce,
      callbackUrl,
      recipient,
      derivationPath,
    });
    const publicKey = await this.ledgerState.client.getPublicKey({
      derivationPath,
      checkOnDevice: false,
    });
    return {
      accountId,
      publicKey: nearAPI.utils.PublicKey.from(publicKey),
      signature,
    };
  }

  async signTransaction(
    transaction: NearTransaction
  ): Promise<[Uint8Array, SignedTransaction]> {
    const derivationPath = this._getDerivationPath();
    console.log("start signing transaction", transaction);
    const signature = await this.ledgerState.client.signTransaction({
      derivationPath,
      signerId: transaction.signerId,
      receiverId: transaction.receiverId,
      actions: transaction.actions,
    });
    return Promise.resolve([
      signature,
      new SignedTransaction({
        transaction,
        signature: new nearAPI.transactions.Signature({
          data: signature,
          keyType: nearAPI.utils.key_pair.KeyType.ED25519,
        }),
      }),
    ]);
  }
}

const Ledger: WalletBehaviourFactory<LedgerHardwareWallet> = async ({
  options,
  store,
  logger,
  storage,
  metadata,
}) => {
  const _state = await setupLedgerState(storage, logger);
  const provider: JsonRpcProvider = new nearAPI.providers.JsonRpcProvider({
    url: options.network.nodeUrl,
  });

  const signer = new LedgerSigner(_state, store);

  const getAccounts = (): Array<Account> => {
    return _state.accounts.map((x) => ({
      accountId: x.accountId,
      publicKey: "ed25519:" + x.publicKey,
      derivationPath: x.derivationPath,
    }));
  };

  const cleanup = () => {
    _state.subscriptions.forEach((subscription) => subscription.remove());

    _state.subscriptions = [];
    _state.accounts = [];

    storage.removeItem(STORAGE_ACCOUNTS);
  };

  const signOut = async () => {
    if (_state.client.isConnected()) {
      await _state.client.disconnect().catch((err) => {
        logger.log("Failed to disconnect device");
        logger.error(err);
      });
    }

    cleanup();
  };

  const connectLedgerDevice = async (transport: string) => {
    if (_state.client.isConnected()) {
      return;
    }

    await _state.client.connect(transport);
  };

  const validateAccessKey = async ({
    accountId,
    publicKey,
  }: ValidateAccessKeyParams) => {
    logger.log("validateAccessKey", { accountId, publicKey });
    try {
      const accessKey: AccessKeyView = await provider.query<AccessKeyView>({
        request_type: "view_access_key",
        finality: "final",
        account_id: accountId,
        public_key: publicKey,
      });
      logger.log("validateAccessKey:accessKey", { accessKey });

      if (accessKey.permission !== "FullAccess") {
        throw new Error("Public key requires 'FullAccess' permission");
      }

      return accessKey;
    } catch (err) {
      if (
        typeof err === "object" &&
        err != null &&
        "type" in err &&
        err.type === "AccessKeyDoesNotExist"
      ) {
        return null;
      }

      throw err;
    }
  };

  const transformTransactions = (
    transactions: Array<Optional<WalletTransaction, "signerId" | "receiverId">>
  ): Array<WalletTransaction> => {
    const { contract } = store.getState();

    if (!contract) {
      throw new Error("Wallet not signed in");
    }

    const account = getActiveAccount(store.getState());

    if (!account) {
      throw new Error("No active account");
    }

    return transactions.map((transaction) => {
      return {
        signerId: transaction.signerId || account.accountId,
        receiverId: transaction.receiverId || contract.contractId,
        actions: transaction.actions,
      };
    });
  };

  return {
    async signIn({ accounts }) {
      const existingAccounts = getAccounts();

      if (existingAccounts.length) {
        return existingAccounts;
      }

      const ledgerAccounts: Array<LedgerAccount> = [];

      for (let i = 0; i < accounts.length; i++) {
        const { derivationPath, accountId, publicKey } = accounts[i];

        const accessKey = await validateAccessKey({ accountId, publicKey });

        if (!accessKey) {
          throw new Error(
            `Public key is not registered with the account '${accountId}'.`
          );
        }

        ledgerAccounts.push({
          accountId,
          derivationPath,
          publicKey,
        });
      }

      await storage.setItem(STORAGE_ACCOUNTS, ledgerAccounts);
      _state.accounts = ledgerAccounts;

      return getAccounts();
    },

    signOut,

    async getAccounts() {
      return getAccounts();
    },

    async verifyOwner({ message }) {
      logger.log("Ledger:verifyOwner", { message });

      throw new Error(`Method not supported by ${metadata.name}`);
    },

    async signAndSendTransaction({ signerId, receiverId, actions }) {
      logger.log("signAndSendTransaction", { signerId, receiverId, actions });

      if (!_state.accounts.length) {
        throw new Error("Wallet not signed in");
      }

      // Note: Connection must be triggered by user interaction.
      await connectLedgerDevice(metadata.transport);

      const signedTransactions = await signTransactions(
        transformTransactions([{ signerId, receiverId, actions }]),
        signer,
        options.network
      );
      console.log("sign and send tx 111", provider, signedTransactions[0]);
      const encodedTx = serialize(
        nearAPI.transactions.SCHEMA.SignedTransaction,
        signedTransactions[0]
      );
      console.log("sign and send tx", provider, signedTransactions[0]);
      const result = await provider.sendJsonRpc("send_tx", {
        signed_tx_base64: Buffer.from(encodedTx).toString("base64"),
        wait_until: "INCLUDED_FINAL",
      });
      console.log("JSONRPC result", result);
      return provider.sendTransactionAsync(signedTransactions[0]);
    },

    async signAndSendTransactions({ transactions }) {
      logger.log("signAndSendTransactions", { transactions });

      if (!_state.accounts.length) {
        throw new Error("Wallet not signed in");
      }

      // Note: Connection must be triggered by user interaction.
      await connectLedgerDevice(metadata.transport);

      const signedTransactions = await signTransactions(
        transformTransactions(transactions),
        signer,
        options.network
      );

      const results: Array<FinalExecutionOutcome> = [];

      for (let i = 0; i < signedTransactions.length; i++) {
        results.push(await provider.sendTransaction(signedTransactions[i]));
      }

      return results;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async getPublicKey(derivationPath?: string): Promise<any> {
      await connectLedgerDevice(metadata.transport);

      if (typeof derivationPath === "string") {
        const pkey = await _state.client.getPublicKey({ derivationPath });
        console.log("GET PUBLIC KEY FROM CLIENT 111::", pkey);
        return pkey;
      } else {
        const account = getActiveAccount(store.getState());

        if (!account) {
          throw new Error("No active account");
        }

        const activeAccount = _state.accounts.find(
          ({ accountId }) => accountId === account.accountId
        );

        if (!activeAccount) {
          throw new Error("No active account in state");
        }

        const pk = await _state.client.getPublicKey({
          derivationPath: activeAccount.derivationPath,
        });
        console.log("GET PUBLIC KEY FROM CLIENT::", pk);

        return nearAPI.utils.PublicKey.fromString(pk);
      }
    },

    async signMessage({
      message,
      nonce,
      recipient,
      callbackUrl,
    }: SignMessageParams): Promise<SignedMessage | void> {
      logger.log("signMessage", { message, nonce, recipient, callbackUrl });

      if (!_state.accounts.length) {
        throw new Error("Wallet not signed in");
      }

      const account = getActiveAccount(store.getState());

      if (!account) {
        throw new Error("No active account");
      }

      const ledgerAccount = _state.accounts.find(
        (a) => a.accountId === account.accountId
      );

      if (!ledgerAccount) {
        throw new Error("Failed to find account for signing");
      }

      const publicKeyExistsInAccount = await verifyFullKeyBelongsToUser({
        publicKey: ledgerAccount.publicKey,
        accountId: account.accountId,
        network: options.network,
      });

      if (!publicKeyExistsInAccount) {
        throw new Error("Public key not found for the active account.");
      }

      // Note: Connection must be triggered by user interaction.
      await connectLedgerDevice(metadata.transport);

      const signature = await _state.client.signMessage({
        derivationPath: ledgerAccount.derivationPath,
        message,
        nonce,
        recipient,
        callbackUrl,
      });
      console.log("signature to resolve", signature);

      const encodedSignature = Buffer.from(signature).toString("base64");
      console.log("signature to resolve", encodedSignature);

      const isSignatureValid = verifySignature({
        publicKey: ledgerAccount.publicKey,
        signature: encodedSignature,
        message,
        nonce,
        recipient,
        callbackUrl,
      });

      if (!isSignatureValid) {
        throw new Error("Failed to verify signature");
      }

      return {
        accountId: ledgerAccount.accountId,
        publicKey: "ed25519:" + ledgerAccount.publicKey,
        signature: encodedSignature,
      };
    },

    async createSignedTransaction(receiverId, actions) {
      logger.log("createSignedTransaction", { receiverId, actions });

      if (!_state.accounts.length) {
        throw new Error("Wallet not signed in");
      }

      // Note: Connection must be triggered by user interaction.
      await connectLedgerDevice(metadata.transport);

      const [signedTransactions] = await signTransactions(
        transformTransactions([{ receiverId, actions }]),
        signer,
        options.network
      );

      return signedTransactions;
    },

    async signTransaction(transaction) {
      logger.log("signTransaction", { transaction });
      return await signer.signTransaction(transaction);
    },

    async signNep413Message(message, accountId, recipient, nonce, callbackUrl) {
      logger.log("signNep413Message", {
        message,
        accountId,
        recipient,
        nonce,
        callbackUrl,
      });
      const signedMessage = await signer.signNep413Message(
        message,
        accountId,
        recipient,
        nonce,
        callbackUrl
      );

      return {
        ...signedMessage,
        signature: Buffer.from(signedMessage.signature),
        publicKey: nearAPI.utils.PublicKey.fromString(signedMessage.publicKey),
      };
    },

    async signDelegateAction(delegateAction) {
      logger.log("signDelegateAction", { delegateAction });

      return signer.signDelegateAction(delegateAction);
    },
  };
};

export function setupLedger({
  iconUrl = icon,
  deprecated = false,
  transport = webHidIdentifier,
}: LedgerParams = {}): WalletModuleFactory<HardwareWallet> {
  return async () => {
    const mobile = isMobile();
    const supported = true;

    if (mobile) {
      return null;
    }

    return {
      id: "ledger",
      type: "hardware",
      metadata: {
        name: "Ledger",
        description:
          "Protect crypto assets with the most popular hardware wallet.",
        iconUrl,
        deprecated,
        available: supported,
        transport,
      },
      init: Ledger,
    };
  };
}
