import { EMeasurementServerType } from "../enums/measurement-server-type.enum"
import { IMeasurementRegistrationRequest } from "../interfaces/measurement-registration-request.interface"
import { UserSettingsRequest } from "./user-settings-request.dto"

export class MeasurementRegistrationRequest
    implements IMeasurementRegistrationRequest
{
    client = EMeasurementServerType.RMBT
    language = ""
    measurement_server_id: number | undefined
    measurement_type_flag = "regular"
    prefer_server: number | undefined
    time = new Date().getTime()
    timezone = ""
    type = ""
    user_server_selection = false

    constructor(
        public uuid: string,
        measurementServerId?: number,
        settingsRequest?: UserSettingsRequest
    ) {
        if (typeof measurementServerId === "number") {
            this.prefer_server = measurementServerId
            this.measurement_server_id = measurementServerId
            this.user_server_selection = true
        }
        if (settingsRequest) {
            Object.assign(this, {
                capabilities: settingsRequest.capabilities,
                client: settingsRequest.name,
                language: settingsRequest.language,
                operating_system: settingsRequest.operating_system,
                platform: settingsRequest.platform,
                timezone: settingsRequest.timezone,
                type: settingsRequest.type,
            })
        }
    }
}
