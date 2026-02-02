/**
 * NFC reader (DFRobot PN532 UART module, e.g. DFR0231-H)
 */
//% weight=10 color=#1d8045 icon="\uf0e7" block="NFC"
namespace NFC {
    let myNFCevent: Action = null;

    let receivedLen = 0;
    let password = pins.createBuffer(6);
    let receivedBuffer = pins.createBuffer(25);

    // Allow up to 10-byte UID (covers 4/7/10)
    let uid = pins.createBuffer(10);

    let myRxPin = SerialPin.P14;
    let myTxPin = SerialPin.P13;
    let init = false;

    password[0] = 0xFF;
    password[1] = 0xFF;
    password[2] = 0xFF;
    password[3] = 0xFF;
    password[4] = 0xFF;
    password[5] = 0xFF;

    //% advanced=true shim=NFC::RxBufferedSize
    function RxBufferedSize(): number {
        return 1
    }

    function wakeup(): void {
        let myBuffer: number[] = [];
        myBuffer = [
            0x55, 0x55, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0x03, 0xfd, 0xd4,
            0x14, 0x01, 0x17, 0x00
        ];
        let wake = pins.createBufferFromArray(myBuffer);
        serial.writeBuffer(wake);
        basic.pause(50);

        receivedLen = RxBufferedSize();
        if (receivedLen > 0) {
            // Read whatever is available (cap it)
            let toRead = receivedLen;
            if (toRead > 64) toRead = 64;
            receivedBuffer = serial.readBuffer(toRead);
        }
    }

    /**
     * Setup DFRobot NFC module Tx Rx to micro:bit pins.
     * 設定DFRobot的Tx、Rx連接腳位
     * @param pinTX to pinTX ,eg: SerialPin.P13
     * @param pinRX to pinRX ,eg: SerialPin.P14
    */
    //% weight=100
    //% blockId="NFC_setSerial" block="set NFC TX to %pinTX | RX to %pinRX"
    export function NFC_setSerial(pinTX: SerialPin, pinRX: SerialPin): void {
        myRxPin = pinRX;
        myTxPin = pinTX;
        serial.redirect(
            pinRX,
            pinTX,
            BaudRate.BaudRate115200
        )
        init = true;
    }

    //% weight=95
    //% blockId="NFC_disconnect" block="NFC disconnect"
    export function NFC_disconnect(): void {
        init = false;
    }

    //% weight=94
    //% blockId="NFC_reconnect" block="NFC reconnect"
    export function NFC_reconnect(): void {
        serial.redirect(
            myRxPin,
            myTxPin,
            BaudRate.BaudRate115200
        )
        init = true;
    }

//% weight=90
//% blockId="nfcEvent" block="When RFID card is detected"
export function nfcEvent(tempAct: Action) {
    myNFCevent = tempAct;
}

/**
 * Temporarily stop NFC polling, print to USB serial, then reconnect NFC UART.
 */
//% block="USB serial print %text"
//% weight=9
export function usbSerialPrint(text: string): void {
    // Stop the background poll loop from firing while we swap serial
    init = false

    // Switch serial back to USB so serial.writeString/writeLine goes to PC
    serial.redirectToUSB()

    // Print to PC
    serial.writeLine(text)

    // Switch UART back to PN532 pins
    serial.redirect(myRxPin, myTxPin, BaudRate.BaudRate115200)

    // Resume polling
    init = true
}

    // ---------- Helpers (robust PN532 parsing) ----------

    function readAllAvailable(maxBytes: number, pauseMs: number): Buffer {
        basic.pause(pauseMs);
        let n = RxBufferedSize();
        if (n <= 0) return pins.createBuffer(0);
        if (n > maxBytes) n = maxBytes;
        return serial.readBuffer(n);
    }

    function indexOfD5_4B(buf: Buffer): number {
        for (let i = 0; i < buf.length - 1; i++) {
            if (buf[i] == 0xD5 && buf[i + 1] == 0x4B) return i;
        }
        return -1;
    }

    function parseUIDFromInListPassiveTarget(resp: Buffer): number[] {
        // Look for PN532 payload: D5 4B ...
        let p = indexOfD5_4B(resp);
        if (p < 0) return [];

        // We need at least: D5 4B NbTg Tg SensRes(2) SelRes UIDLen
        if (p + 7 >= resp.length) return [];

        let nbTg = resp[p + 2];
        if (nbTg < 1) return [];

        // Typical format after D5 4B:
        // [p+2]=NbTg, [p+3]=Tg, [p+4..5]=SensRes, [p+6]=SelRes, [p+7]=UIDLen, [p+8..]=UID
        let uidLen = resp[p + 7];
        let uidStart = p + 8;

        if (uidLen < 4 || uidLen > 10) return [];
        if (uidStart + uidLen > resp.length) return [];

        let arr: number[] = [];
        for (let i = 0; i < uidLen; i++) arr.push(resp[uidStart + i]);
        return arr;
    }

    function getHexStr(myNum: number): string {
        let tempStr = "";
        if (myNum < 0x0A) {
            tempStr += myNum.toString();
        } else {
            switch (myNum) {
                case 0x0A: tempStr += "A"; break;
                case 0x0B: tempStr += "B"; break;
                case 0x0C: tempStr += "C"; break;
                case 0x0D: tempStr += "D"; break;
                case 0x0E: tempStr += "E"; break;
                case 0x0F: tempStr += "F"; break;
                default: break;
            }
        }
        return tempStr;
    }

    function convertString(myBuffer: number[], len: number): string {
        let myStr = "";
        let temp = 0;
        for (let i = 0; i < len; i++) {
            temp = (myBuffer[i] & 0xF0) >> 4;
            myStr += getHexStr(temp);
            temp = (myBuffer[i] & 0x0F);
            myStr += getHexStr(temp);
        }
        return myStr;
    }

    // ---------- Public API ----------

    /**
     * RFID UID string (supports 4/7/10 byte UIDs, including MIFARE Ultralight)
     */
    //% weight=80
    //% blockId="getUID" block="RFID UID string"
    export function getUID(): string {
        serial.setRxBufferSize(128);
        wakeup();

        // PN532 InListPassiveTarget (1 target, 106 kbps Type A)
        let cmd = [0x00, 0x00, 0xFF, 0x04, 0xFC, 0xD4, 0x4A, 0x01, 0x00, 0xE1, 0x00];
        serial.writeBuffer(pins.createBufferFromArray(cmd));

        // Read response (don’t assume fixed length)
        let resp = readAllAvailable(80, 60);
        if (resp.length == 0) return "";

        let uidArr = parseUIDFromInListPassiveTarget(resp);
        if (uidArr.length == 0) return "";

        return convertString(uidArr, uidArr.length);
    }

    /**
     * Detected RFID card?
     */
    //% weight=70
    //% blockId="detectedRFIDcard" block="Detected RFID card?"
    export function detectedRFIDcard(): boolean {
        serial.setRxBufferSize(128);
        wakeup();

        let cmd = [0x00, 0x00, 0xFF, 0x04, 0xFC, 0xD4, 0x4A, 0x01, 0x00, 0xE1, 0x00];
        serial.writeBuffer(pins.createBufferFromArray(cmd));

        let resp = readAllAvailable(80, 60);
        if (resp.length == 0) return false;

        let uidArr = parseUIDFromInListPassiveTarget(resp);
        return uidArr.length > 0;
    }

    // ---------- Background polling ----------

    basic.forever(() => {
        if (init && (myNFCevent != null)) {
            if (detectedRFIDcard()) {
                myNFCevent();
            }
            basic.pause(50);
        }
    })
}
