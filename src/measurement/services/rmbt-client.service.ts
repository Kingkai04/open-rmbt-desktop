import { MeasurementThreadResult } from "../dto/measurement-thread-result.dto"
import { EMeasurementStatus } from "../enums/measurement-status.enum"
import { IMeasurementRegistrationResponse } from "../interfaces/measurement-registration-response.interface"
import {
    IMeasurementThreadResult,
    IMeasurementThreadResultList,
} from "../interfaces/measurement-result.interface"
import {
    IncomingMessageWithData,
    RMBTWorker,
} from "../interfaces/rmbt-worker.interface"
import { Logger } from "./logger.service"
import { RMBTWorkerFactory } from "./rmbt-worker-factory.service"
import { Time } from "./time.service"
import path from "path"
import { IOverallResult } from "../interfaces/overall-result.interface"
import { IPreDownloadResult, RMBTThread } from "./rmbt-thread.service"

export class RMBTClient {
    measurementLastUpdate?: number
    measurementStatus: EMeasurementStatus = EMeasurementStatus.WAIT
    measurementTasks: RMBTThread[] = []
    minChunkSize = 0
    maxChunkSize = 4194304
    params: IMeasurementRegistrationResponse
    initializedThreads: number[] = []
    interimThreadResults: IMeasurementThreadResult[] = []
    threadResults: IMeasurementThreadResult[] = []
    downThreadResults: IMeasurementThreadResult[] = []
    upThreadResults: IMeasurementThreadResult[] = []
    chunks: number[] = []
    timestamps: { index: number; time: number }[] = []
    pingMedian = -1
    measurementStart: number = 0
    isRunning = false
    activityInterval?: NodeJS.Timer
    overallResultDown?: IOverallResult
    overallResultUp?: IOverallResult
    private bytesPerSecPreDownload: number[] = []
    private estimatePhaseDuration: { [key: string]: number } = {
        [EMeasurementStatus.INIT]: 0.5,
        [EMeasurementStatus.INIT_DOWN]: 2.5,
        [EMeasurementStatus.PING]: 1.5,
        [EMeasurementStatus.DOWN]: -1,
        [EMeasurementStatus.INIT_UP]: 5,
        [EMeasurementStatus.UP]: -1,
    }
    private phaseStartTimeNs: { [key: string]: number } = {
        [EMeasurementStatus.INIT]: -1,
        [EMeasurementStatus.INIT_DOWN]: -1,
        [EMeasurementStatus.PING]: -1,
        [EMeasurementStatus.DOWN]: -1,
        [EMeasurementStatus.INIT_UP]: -1,
        [EMeasurementStatus.UP]: -1,
    }

    get downloadSpeedTotalMbps() {
        return (this.overallResultDown?.speed ?? 0) / 1e6
    }

    get uploadSpeedTotalMbps() {
        return (this.overallResultUp?.speed ?? 0) / 1e6
    }

    constructor(params: IMeasurementRegistrationResponse) {
        this.params = params
        this.estimatePhaseDuration[EMeasurementStatus.DOWN] = Number(
            params.test_duration
        )
        this.estimatePhaseDuration[EMeasurementStatus.UP] = Number(
            params.test_duration
        )
    }

    getPhaseDuration(phase: string) {
        return (Time.nowNs() - this.phaseStartTimeNs[phase]) / 1e9
    }

    getPhaseProgress(phase: string) {
        const estimatePhaseDuration = this.estimatePhaseDuration[phase] ?? -1
        return Math.min(1, this.getPhaseDuration(phase) / estimatePhaseDuration)
    }

    async scheduleMeasurement(): Promise<IMeasurementThreadResult[]> {
        Logger.I.info("Scheduling measurement...")
        this.measurementLastUpdate = new Date().getTime()
        if (this.params.test_wait > 0) {
            this.measurementStatus = EMeasurementStatus.WAIT
            return new Promise((resolve) => {
                setTimeout(async () => {
                    resolve(await this.runMeasurement())
                }, this.params.test_wait * 1000)
            })
        } else {
            return this.runMeasurement()
        }
    }

    private async runMeasurement(): Promise<IMeasurementThreadResult[]> {
        this.isRunning = true
        this.measurementStart = Date.now()
        return new Promise(async (finishMeasurement) => {
            Logger.I.info("Running measurement...")
            this.activityInterval = setInterval(() => {
                if (
                    !this.isRunning ||
                    Date.now() - this.measurementStart >= 60000
                ) {
                    this.overallResultUp = this.getOverallResult(
                        this.threadResults,
                        (threadResult) => threadResult?.up
                    )
                    this.upThreadResults = [...this.threadResults]
                    this.threadResults = []
                    this.interimThreadResults = new Array(
                        this.params.test_numthreads
                    )
                    clearInterval(this.activityInterval)
                    finishMeasurement([
                        ...this.downThreadResults,
                        ...this.upThreadResults,
                    ])
                    this.measurementStatus = EMeasurementStatus.SPEEDTEST_END
                    this.phaseStartTimeNs[EMeasurementStatus.SPEEDTEST_END] =
                        Time.nowNs()
                    Logger.I.info(
                        `Upload is finished in ${this.getPhaseDuration(
                            EMeasurementStatus.UP
                        )}s`
                    )
                    Logger.I.info(
                        `The total upload speed is ${this.uploadSpeedTotalMbps}Mbps`
                    )
                    Logger.I.info("Measurement is finished")
                }
            }, 1000)
            this.measurementStatus = EMeasurementStatus.INIT
            this.interimThreadResults = new Array(this.params.test_numthreads)
            this.phaseStartTimeNs[EMeasurementStatus.INIT] = Time.nowNs()

            for (let index = 0; index < this.params.test_numthreads; index++) {
                const thread = new RMBTThread(this.params, index)
                this.measurementTasks.push(thread)
            }

            await Promise.all(
                this.measurementTasks.map((t) =>
                    t.connect(new MeasurementThreadResult())
                )
            )
            await Promise.all(this.measurementTasks.map((t) => t.manageInit()))
            this.measurementStatus = EMeasurementStatus.INIT_DOWN
            this.phaseStartTimeNs[EMeasurementStatus.INIT_DOWN] = Time.nowNs()
            Logger.I.warn(
                "Init is finished in %d s",
                this.getPhaseDuration(EMeasurementStatus.INIT)
            )
            await Promise.all(
                this.measurementTasks.map(async (thread) => {
                    const { chunkSize, bytesPerSec } =
                        await thread?.managePreDownload()
                    this.chunks.push(chunkSize)
                    this.bytesPerSecPreDownload.push(bytesPerSec)
                })
            )
            this.checkIfShouldUseOneThread(this.chunks)
            this.chunks = []
            this.measurementStatus = EMeasurementStatus.PING
            this.phaseStartTimeNs[EMeasurementStatus.PING] = Time.nowNs()
            Logger.I.warn(
                "Pre-download is finished in %d s",
                this.getPhaseDuration(EMeasurementStatus.INIT_DOWN)
            )

            this.pingMedian =
                ((await this.measurementTasks[0].managePing()).ping_median ??
                    -1000000) / 1000000
            const calculatedChunkSize = this.getChunkSize()
            this.measurementStatus = EMeasurementStatus.DOWN
            this.phaseStartTimeNs[EMeasurementStatus.DOWN] = Time.nowNs()
            Logger.I.info(`The ping median is ${this.pingMedian}ms.`)
            Logger.I.warn(
                "Ping is finished in %d s",
                this.getPhaseDuration(EMeasurementStatus.PING)
            )

            await Promise.all(
                this.measurementTasks.map(async (thread, index) => {
                    thread.interimHandler = (interimResult) => {
                        this.interimThreadResults[index] = interimResult
                        this.overallResultDown = this.getOverallResult(
                            this.interimThreadResults,
                            (threadResult) => threadResult?.down
                        )
                    }
                    const result = await thread.manageDownload(
                        calculatedChunkSize
                    )
                    this.threadResults.push(result)
                })
            )

            this.overallResultDown = this.getOverallResult(
                this.threadResults,
                (threadResult) => threadResult?.down
            )
            this.downThreadResults = [...this.threadResults]
            this.threadResults = []
            this.interimThreadResults = new Array(this.params.test_numthreads)
            this.measurementStatus = EMeasurementStatus.INIT_UP
            this.phaseStartTimeNs[EMeasurementStatus.INIT_UP] = Time.nowNs()
            Logger.I.info(
                `Download is finished in ${this.getPhaseDuration(
                    EMeasurementStatus.DOWN
                )}s`
            )
            Logger.I.info(
                `The total download speed is ${this.downloadSpeedTotalMbps}Mbps`
            )

            await Promise.all(
                this.measurementTasks.map((thread) =>
                    thread.connect(thread.threadResult)
                )
            )
            await Promise.all(
                this.measurementTasks.map((thread) => thread.manageInit())
            )
            await Promise.all(
                this.measurementTasks.map(async (thread) => {
                    const chunks = await thread.managePreUpload()
                    this.chunks.push(chunks)
                })
            )

            await new Promise((resolve) => {
                setTimeout(() => resolve(void 0), 200)
            })

            // this.checkIfShouldUseOneThread(this.chunks)
            this.chunks = []
            this.measurementStatus = EMeasurementStatus.UP
            this.phaseStartTimeNs[EMeasurementStatus.UP] = Time.nowNs()
            Logger.I.info(
                `Pre-upload is finished in ${this.getPhaseDuration(
                    EMeasurementStatus.INIT_UP
                )}s`
            )

            await Promise.all(
                this.measurementTasks.map((thread) =>
                    thread.connect(thread.threadResult)
                )
            )
            await Promise.all(
                this.measurementTasks.map((thread) => thread.manageInit())
            )

            await Promise.all(
                this.measurementTasks.map(async (thread, index) => {
                    thread.interimHandler = (interimResult) => {
                        this.interimThreadResults[index] = interimResult
                        this.overallResultUp = this.getOverallResult(
                            this.interimThreadResults,
                            (threadResult) => threadResult?.up
                        )
                    }
                    const result = await thread.manageUpload()
                    this.threadResults.push(result)
                })
            )
            this.isRunning = false
        })
    }

    private checkIfShouldUseOneThread(chunkNumbers: number[]) {
        Logger.I.info("Checking if should use one thread.")
        const threadWithLowestChunkNumber = chunkNumbers.findIndex(
            (c) => c <= 4
        )
        if (threadWithLowestChunkNumber >= 0) {
            Logger.I.info("Switching to one thread.")
            this.measurementTasks = this.measurementTasks.reduce(
                (acc, mt, index) => {
                    if (index === 0) {
                        return [mt]
                    }
                    return acc
                },
                [] as RMBTThread[]
            )
        }
    }

    // From https://github.com/rtr-nettest/rmbtws/blob/master/src/WebsockettestDatastructures.js#L177
    private getOverallResult(
        threads: IMeasurementThreadResult[],
        phaseResults: (
            thread: IMeasurementThreadResult
        ) => IMeasurementThreadResultList
    ) {
        let numThreads = threads.length
        let targetTime = Infinity

        for (let i = 0; i < numThreads; i++) {
            if (!phaseResults(threads[i])) {
                continue
            }
            let nsecs = phaseResults(threads[i]).nsec
            if (nsecs.length > 0) {
                if (nsecs[nsecs.length - 1] < targetTime) {
                    targetTime = nsecs[nsecs.length - 1]
                }
            }
        }

        let totalBytes = 0

        for (let _i = 0; _i < numThreads; _i++) {
            if (!phaseResults(threads[_i])) {
                continue
            }
            let thread = threads[_i]
            let phasedThreadNsec = phaseResults(thread).nsec
            let phasedThreadBytes = phaseResults(thread).bytes
            let phasedLength = phasedThreadNsec.length

            if (thread !== null && phasedLength > 0) {
                let targetIdx = phasedLength
                for (let j = 0; j < phasedLength; j++) {
                    if (phasedThreadNsec[j] >= targetTime) {
                        targetIdx = j
                        break
                    }
                }
                let calcBytes = 0
                if (phasedThreadNsec[targetIdx] === targetTime) {
                    // nsec[max] == targetTime
                    calcBytes = phasedThreadBytes[phasedLength - 1]
                } else {
                    let bytes1 =
                        targetIdx === 0 ? 0 : phasedThreadBytes[targetIdx - 1]
                    let bytes2 = phasedThreadBytes[targetIdx]
                    let bytesDiff = bytes2 - bytes1
                    let nsec1 =
                        targetIdx === 0 ? 0 : phasedThreadNsec[targetIdx - 1]
                    let nsec2 = phasedThreadNsec[targetIdx]
                    let nsecDiff = nsec2 - nsec1
                    let nsecCompensation = targetTime - nsec1
                    let factor = nsecCompensation / nsecDiff
                    let compensation = Math.round(bytesDiff * factor)

                    if (compensation < 0) {
                        compensation = 0
                    }
                    calcBytes = bytes1 + compensation
                }
                totalBytes += calcBytes
            }
        }
        return {
            bytes: totalBytes,
            nsec: targetTime,
            speed: (totalBytes * 8) / (targetTime / 1e9),
        }
    }

    private getChunkSize() {
        const bytesPerSecTotal = this.bytesPerSecPreDownload.reduce(
            (acc, bytes) => acc + bytes,
            0
        )

        // set chunk size to accordingly 1 chunk every n/20 ms on average with n threads
        let chunkSize = Math.floor(
            bytesPerSecTotal / this.params.test_numthreads / (1000 / 20)
        )

        Logger.I.warn(`Calculated chunk size is ${chunkSize}`)

        //but min 4KiB
        chunkSize = Math.max(this.minChunkSize, chunkSize)

        //and max MAX_CHUNKSIZE
        chunkSize = Math.min(this.maxChunkSize, chunkSize)

        Logger.I.warn(`Setting chunk size to ${chunkSize}`)

        return chunkSize
    }
}
