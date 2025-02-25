import { ISpeedItem } from "./measurement-result.interface"
import { IOverallResult } from "./overall-result.interface"

export interface ISimpleHistoryResult {
    measurementDate: string
    measurementServerName: string
    uploadKbit: number
    uploadOverTime?: IOverallResult[]
    downloadKbit: number
    downloadOverTime?: IOverallResult[]
    ping: number
    providerName: string
    ipAddress: string
    fullResultLink: string
    downloadClass?: number
    uploadClass?: number
    pingClass?: number
}
