import React from 'react';
export declare const AddCardTrigger: React.FC<{
    onClick?: (...args: any[]) => void;
}>;
export declare const AddCardTriggerButton: React.FC<{
    onClick?: (...args: any[]) => void;
}>;
interface SimpleEditableCardProps {
    selected?: boolean;
    onDelete?: () => void;
    onSelect?: () => void;
    extended?: boolean;
}
export declare const SimpleEditableCard: React.FC<SimpleEditableCardProps>;
export {};
