import React from 'react';
interface AddCardTriggerProps {
    onClick?: (...args: any[]) => void;
    highlight?: boolean;
    label?: string | JSX.Element;
}
export declare const AddCardTrigger: React.FC<AddCardTriggerProps>;
export declare const AddCardTriggerButton: React.FC<AddCardTriggerProps>;
interface SimpleEditableCardProps {
    selected?: boolean;
    onDelete?: () => void;
    onSelect?: () => void;
    extended?: boolean;
}
export declare const SimpleEditableCard: React.FC<SimpleEditableCardProps>;
export {};
