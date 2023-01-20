import {
    IMeasurementThreadResultList,
    ISpeedItem,
} from "../interfaces/measurement-result.interface"
import { Logger } from "../services/logger.service"

export class MeasurementThreadResultList
    implements IMeasurementThreadResultList
{
    bytes: number[] = []
    nsec: number[] = []
    private resultsCounter = 0

    constructor(private maxStoredResults: number = Infinity) {}

    addResult(newBytes: number, newNsec: number) {
        Logger.I.info("New bytes: %d. New nsec: %d.", newBytes, newNsec)
        const expectedNsecDiff = (20 * 7e9) / this.maxStoredResults
        let nsecDiff = newNsec
        if (this.resultsCounter > 0) {
            const prevNsec = this.nsec[this.resultsCounter - 1]
            nsecDiff = newNsec - prevNsec
        }
        if (
            newBytes >= 0 &&
            newNsec >= 0 &&
            this.resultsCounter < this.maxStoredResults &&
            nsecDiff >= expectedNsecDiff
        ) {
            this.bytes[this.resultsCounter] = newBytes
            this.nsec[this.resultsCounter] = newNsec
            this.resultsCounter += 1
        }
    }

    getSpeedItems(direction: "download" | "upload", thread: number) {
        const speedItems: ISpeedItem[] = new Array(this.maxStoredResults)
        for (let i = 0; i < this.maxStoredResults; i++) {
            speedItems[i] = {
                direction,
                thread,
                time: this.nsec[i],
                bytes: this.bytes[i],
            }
        }
        return speedItems
    }
}
