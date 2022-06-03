import { Worker } from "worker_threads"
import { MeasurementThreadResult } from "../dto/measurement-result.dto"
import { EMeasurementStatus } from "../enums/measurement-status.enum"
import { IMeasurementRegistrationResponse } from "../interfaces/measurement-registration-response.interface"
import { IMeasurementThreadResult } from "../interfaces/measurement-result.interface"
import { Logger } from "./logger.service"
import { IncomingMessage, OutgoingMessageWithData } from "./worker.service"

export class RMBTClientService {
    measurementLastUpdate?: number
    measurementStatus: EMeasurementStatus = EMeasurementStatus.WAIT
    measurementTasks: Worker[] = []
    params: IMeasurementRegistrationResponse
    threadResults: IMeasurementThreadResult[] = []
    chunks: number[] = []

    constructor(params: IMeasurementRegistrationResponse) {
        this.params = params
    }

    scheduleMeasurement() {
        Logger.I.info("Scheduling measurement...")
        this.measurementLastUpdate = new Date().getTime()
        if (this.params.test_wait > 0) {
            this.measurementStatus = EMeasurementStatus.WAIT
            setTimeout(
                this.runMeasurement.bind(this),
                this.params.test_wait * 1000
            )
        } else {
            this.runMeasurement()
        }
    }

    private async runMeasurement() {
        Logger.I.info("Running measurement...")
        this.measurementStatus = EMeasurementStatus.INIT
        for (let i = 0; i < this.params.test_numthreads; i++) {
            this.measurementTasks.push(
                new Worker("./dist/measurement/services/worker.service.js", {
                    workerData: {
                        params: this.params,
                        index: i,
                        result: new MeasurementThreadResult(),
                    },
                })
            )
        }

        for (const [index, worker] of this.measurementTasks.entries()) {
            worker.postMessage("connect")
            worker.on("message", (message: OutgoingMessageWithData) => {
                switch (message.message) {
                    case "connected":
                        Logger.I.warn(`Worker ${index} is connected`)
                        this.threadResults.push(new MeasurementThreadResult())
                        if (
                            this.threadResults.length ===
                            this.measurementTasks.length
                        ) {
                            for (const w of this.measurementTasks) {
                                w.postMessage("preDownload" as IncomingMessage)
                            }
                            this.threadResults = []
                        }
                        break
                    case "preDownloadFinished":
                        Logger.I.warn(
                            `Worker ${index} finished pre-download with ${this.chunks} chunks.`
                        )
                        this.chunks.push(message.chunks)
                        if (
                            this.chunks.length === this.measurementTasks.length
                        ) {
                            this.measurementTasks[0].postMessage(
                                "ping" as IncomingMessage
                            )
                            this.chunks = []
                        }
                        break
                    case "pingFinished":
                        Logger.I.info(
                            `The ping median is ${
                                (message.result?.ping_median || 0n) / 1000000n
                            }ms.`
                        )
                        for (const w of this.measurementTasks) {
                            w.postMessage("download" as IncomingMessage)
                        }
                        break
                    case "downloadFinished":
                        this.threadResults.push(message.result!)
                        if (
                            this.threadResults.length ===
                            this.measurementTasks.length
                        ) {
                            Logger.I.info(
                                `The total download speed is ${
                                    this.getTotalSpeed() / 1000000
                                }Mbps`
                            )
                            this.threadResults = []
                            for (const w of this.measurementTasks) {
                                w.postMessage("preUpload" as IncomingMessage)
                            }
                        }
                        break
                    case "preUploadFinished":
                        Logger.I.warn(
                            `Worker ${index} finished pre-upload with ${this.chunks} chunks.`
                        )
                        this.chunks.push(message.chunks)
                        if (
                            this.chunks.length === this.measurementTasks.length
                        ) {
                            for (const w of this.measurementTasks) {
                                w.postMessage("upload" as IncomingMessage)
                            }
                            this.chunks = []
                        }
                        break
                    case "uploadFinished":
                        this.threadResults.push(message.result!)
                        if (
                            this.threadResults.length ===
                            this.measurementTasks.length
                        ) {
                            Logger.I.info(
                                `The total upload speed is ${
                                    this.getTotalSpeed() / 1000000
                                }Mbps`
                            )
                            this.threadResults = []
                            for (const w of this.measurementTasks) {
                                w.terminate()
                            }
                        }
                        break
                }
            })
        }
    }

    private checkIfShouldUseOneThread(chunkNumbers: number[]) {
        Logger.I.info("Checking if should use one thread.")
        const threadWithLowestChunkNumber = chunkNumbers.findIndex(
            (c) => c <= 4
        )
        if (threadWithLowestChunkNumber >= 0) {
            Logger.I.info("Switching to one thread.")
            // this.measurementTasks = this.measurementTasks.reduce(
            //     (acc, mt, index) => {
            //         if (index === 0) {
            //             return [mt]
            //         }
            //         mt.disconnect()
            //         return acc
            //     },
            //     [] as RMBTThreadService[]
            // )
        }
    }

    // in bytes
    private getTotalSpeed() {
        let sumTrans = 0
        let maxTime = 0n

        for (const task of this.threadResults) {
            if (task.currentTime > maxTime) {
                maxTime = task.currentTime
            }
            sumTrans += task.currentTransfer
        }

        return maxTime === 0n ? 0 : (sumTrans / Number(maxTime)) * 1e9 * 8.0
    }
}
