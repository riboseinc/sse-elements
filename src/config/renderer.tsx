import * as React from 'react';
import { AppConfig } from './app';


export interface RendererConfig<App extends AppConfig> {
  contextProviders: React.FC<{}>[],
  app: App
  windowComponents: Record<
    keyof App["windows"],
    () => Promise<{ default: React.FC<WindowComponentProps> }>>
}


export interface WindowComponentProps {
  query: URLSearchParams,
}
