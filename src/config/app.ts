import { WindowOpenerParams } from '../main/window';


export interface Window {
  openerParams: Omit<WindowOpenerParams, 'component'>,
}


export interface ModelConfig {
  shortName: string,
  verboseName: string,
  verboseNamePlural: string,
}


interface LanguageConfig {
  available: Record<string, string>
  selected: keyof this["available"]
  default: keyof this["available"]
}


export interface AppConfig {
  data: Record<string, ModelConfig>

  windows: {
    default: Window
    [windowName: string]: Window
  }

  languages: LanguageConfig

  help: {
    rootURL: string
  }
}
