import { registerAudioIpc } from "./audio.ipc"
import { registerPipelineIpc } from "./pipeline.ipc"
import { PipelineCoordinator } from "../coordinators/PipelineCoordinator"
import { BrowserWindow } from "electron"

const state = { overlayInteractive: false }

export function registerIpc(deps: {
    coordinator: PipelineCoordinator
    overlayWindow: BrowserWindow
}) {
    registerAudioIpc({ ...deps, state })
    registerPipelineIpc({ coordinator: deps.coordinator, overlayWindow: deps.overlayWindow, state })
}
