import * as React from 'react';
import { AppConfig } from './app';


export interface RendererConfig<App extends AppConfig> {
  app: App,
  windowComponents: Record<keyof App["windows"], () => Promise<{ default: React.FC<WindowComponentProps> }>>,
  contextProviders: React.FC<{}>[],
}


export interface WindowComponentProps {
  query: URLSearchParams,
}
