import { LoggerPlaceholder } from '@marinade.finance/ts-common';
import TrezorConnect from '@trezor/connect';

export const CLI_TREZOR_URL_PREFIX = 'usb://trezor'

export async function getPublicKey(
  pathOrUrl: string,
  logger?: LoggerPlaceholder
) {
    await TrezorConnect.init({
        lazyLoad: true, // this param will prevent iframe injection until TrezorConnect.method will be called
        manifest: {
            email: 'chalda@marinade.finance',
            appUrl: 'https://marinade.finance',
        },
    });
    // const result = await TrezorConnect.getPublicKey(
    //     {
    //         // path: undefined,
    //         showOnTrezor: undefined,
    //         coin: undefined,
    //         // bundle: [],
    //         crossChain: undefined,
    //         chunkify: undefined,
    //         curve: undefined,
    //         ecdsaCurveName: undefined,
    //         ignoreXpubMagic: undefined,
    //         scriptType: undefined,
    //         suppressBackupWarning: undefined,
    //         unlockPath: undefined,
    //         device: {
    //             path: undefined,
    //             state: undefined,
    //             instance: 0
    //         },
    //         useEmptyPassphrase: undefined,
    //         useEventListener: undefined,
    //         allowSeedlessDevice: undefined,
    //         keepSession: undefined,
    //         override: undefined,
    //         skipFinalReload: undefined,
    //         useCardanoDerivation: undefined,
    //     }
    // );
    const result = await TrezorConnect.getPublicKey({
        path: pathOrUrl,
        coin: 'solana',
    });
}