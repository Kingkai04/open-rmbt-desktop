import dayjs from "dayjs"
import utc from "dayjs/plugin/utc"
import tz from "dayjs/plugin/timezone"
import { IUserSettingsRequest } from "../interfaces/user-settings-request.interface"
import { v4 as uuidv4 } from "uuid"
import { EMeasurementServerType } from "../enums/measurement-server-type.enum"
import os from "os"

dayjs.extend(utc)
dayjs.extend(tz)

export class UserSettingsRequest implements IUserSettingsRequest {
    language = "en"
    name = EMeasurementServerType.RMBT
    timezone = dayjs.tz.guess()
    terms_and_conditions_accepted = true
    uuid = ""
    operating_system = `${os.type}, ${os.release}`

    // RTR BE compatibility
    capabilities = { RMBThttp: true }
    type = "DESKTOP"

    constructor(public platform = "DESKTOP") {
        // TODO: store and read the stored UUID
        // let uuid = this.isHistoryAllowed && localStorage.getItem(TEST_COOKIE)
        // if (!uuid && this.isHistoryAllowed) {
        //     uuid = uuidv4()
        //     localStorage.setItem(TEST_COOKIE, uuid)
        // }
        this.uuid = uuidv4()
    }
}
