import React from 'react';
interface PaneHeaderProps {
    major?: boolean;
    minor?: boolean;
    align?: 'left' | 'right';
    className?: string;
}
export declare const PaneHeader: React.FC<PaneHeaderProps>;
export {};
