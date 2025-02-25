import { ITestVisualizationState } from "../interfaces/test-visualization-state.interface"
import { ITestPhaseState } from "../interfaces/test-phase-state.interface"
import { EMeasurementStatus } from "../../../../measurement/enums/measurement-status.enum"
import { IMeasurementPhaseState } from "../../../../measurement/interfaces/measurement-phase-state.interface"
import { extend } from "../helpers/extend"
import { TestPhaseState } from "./test-phase-state.dto"
import { ETestStatuses } from "../enums/test-statuses.enum"
import { ETestLabels } from "../enums/test-labels.enum"

export class TestVisualizationState implements ITestVisualizationState {
    phases: {
        [key: string]: ITestPhaseState
    } = {
        [EMeasurementStatus.NOT_STARTED]: new TestPhaseState(),
        [EMeasurementStatus.WAIT]: new TestPhaseState(),
        [EMeasurementStatus.INIT]: new TestPhaseState(),
        [EMeasurementStatus.INIT_DOWN]: new TestPhaseState(),
        [EMeasurementStatus.PING]: new TestPhaseState({
            label: ETestLabels.PING,
        }),
        [EMeasurementStatus.DOWN]: new TestPhaseState({
            label: ETestLabels.DOWNLOAD,
        }),
        [EMeasurementStatus.INIT_UP]: new TestPhaseState(),
        [EMeasurementStatus.UP]: new TestPhaseState({
            label: ETestLabels.UPLOAD,
        }),
        [EMeasurementStatus.SPEEDTEST_END]: new TestPhaseState(),
        [EMeasurementStatus.SUBMITTING_RESULTS]: new TestPhaseState(),
        [EMeasurementStatus.END]: new TestPhaseState(),
        [EMeasurementStatus.SHOWING_RESULTS]: new TestPhaseState(),
    }
    currentPhaseName: EMeasurementStatus = EMeasurementStatus.NOT_STARTED

    static from(
        initialState: ITestVisualizationState,
        phaseState: IMeasurementPhaseState
    ) {
        const newState = extend<ITestVisualizationState>(initialState)
        if (newState.phases[phaseState.phase]) {
            const newTestPhaseState = extend<ITestPhaseState>(
                newState.phases[phaseState.phase],
                phaseState
            )
            newState.phases[phaseState.phase] = newTestPhaseState
            newState.setCounter(phaseState.phase, newTestPhaseState)
            newState.extendChart(phaseState.phase)
            newState.setDone(phaseState.phase)
        }
        return newState
    }

    setCounter(
        newPhaseName: EMeasurementStatus,
        newTestPhaseState: ITestPhaseState
    ) {
        if (newPhaseName === EMeasurementStatus.DOWN) {
            this.phases[EMeasurementStatus.PING].counter =
                newTestPhaseState.ping
            this.phases[EMeasurementStatus.DOWN].counter =
                newTestPhaseState.down
        } else if (newPhaseName === EMeasurementStatus.UP) {
            this.phases[EMeasurementStatus.UP].counter = newTestPhaseState.up
        } else if (newPhaseName === EMeasurementStatus.SHOWING_RESULTS) {
            this.phases[EMeasurementStatus.PING].counter =
                newTestPhaseState.ping
            this.phases[EMeasurementStatus.DOWN].counter =
                newTestPhaseState.down
            this.phases[EMeasurementStatus.UP].counter = newTestPhaseState.up
        }
    }

    setDone(newPhaseName: EMeasurementStatus) {
        if (newPhaseName === EMeasurementStatus.SHOWING_RESULTS) {
            const containerPhases = [
                EMeasurementStatus.DOWN,
                EMeasurementStatus.UP,
                EMeasurementStatus.PING,
            ]
            for (const phase of containerPhases) {
                this.phases[phase].progress = 1
                this.phases[phase].container = ETestStatuses.DONE
            }
        } else if (newPhaseName !== this.currentPhaseName) {
            this.phases[this.currentPhaseName].progress = 1
            this.phases[this.currentPhaseName].container = ETestStatuses.DONE
            this.phases[newPhaseName].container = ETestStatuses.ACTIVE
        }
        this.currentPhaseName = newPhaseName
    }

    extendChart(newPhaseName: EMeasurementStatus) {
        const newPhase = this.phases[newPhaseName]
        this.phases[newPhaseName].chart = [
            ...(newPhase?.chart || []),
            {
                x: newPhase.progress * 100,
                y: Math.max(0, newPhase.counter),
            },
        ]
    }
}
