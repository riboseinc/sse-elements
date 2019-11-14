import React from 'react';
import { IconName } from '@blueprintjs/icons';
interface AddCardTriggerProps {
    onClick?: (...args: any[]) => void;
    highlight?: boolean;
    label?: string | JSX.Element;
}
export declare const AddCardTrigger: React.FC<AddCardTriggerProps>;
export declare const AddCardTriggerButton: React.FC<AddCardTriggerProps>;
interface SimpleEditableCardProps {
    icon?: IconName;
    selected?: boolean;
    onDelete?: () => void;
    onSelect?: () => void;
    minimal?: boolean;
    extended?: boolean;
}
export declare const SimpleEditableCard: React.FC<SimpleEditableCardProps>;
export {};
