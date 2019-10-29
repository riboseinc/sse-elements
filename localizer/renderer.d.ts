import React from 'react';
import { SupportedLanguages, LangConfig, Translatable } from './types';
interface LangConfigContextSpec extends LangConfig {
    available: SupportedLanguages;
    select(id: string): void;
}
export declare const LangConfigContext: React.Context<LangConfigContextSpec>;
interface TranslatableComponentProps {
    what: Translatable<string>;
}
export declare const Trans: React.FC<TranslatableComponentProps>;
interface LangSelectorProps {
    value?: Translatable<any>;
}
export declare const LangSelector: React.FC<LangSelectorProps>;
export {};
