import { WindowOpenerParams } from '../main/window';


export interface Window {
  openerParams: Omit<WindowOpenerParams, 'component'>,
}


export interface ModelConfig {
  shortName: string,
  verboseName: string,
  verboseNamePlural: string,
}


export interface AppConfig {
  data: Record<string, ModelConfig>

  windows: {
    default: Window
    [windowName: string]: Window
  }


  help: {
    rootURL: string
  }
}
