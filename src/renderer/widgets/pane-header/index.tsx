import React from 'react';
import styles from './styles.scss';


interface PaneHeaderProps {
  major?: boolean,
  minor?: boolean,
  align?: 'left' | 'right',
  className?: string,
}
export const PaneHeader: React.FC<PaneHeaderProps> = function (props) {
  let alignmentClass: string;
  if (props.align === 'left') {
    alignmentClass = styles.paneHeaderAlignedLeft;
  } else if (props.align === 'right') {
    alignmentClass = styles.paneHeaderAlignedRight;
  } else {
    alignmentClass = '';
  }

  return (
    <h2 className={`
      ${styles.paneHeader}
      ${alignmentClass}
      ${props.className ? props.className : ''}
      ${props.major ? styles.paneHeaderMajor : ''}
      ${props.minor ? styles.paneHeaderMinor : ''}
    `}>{props.children}</h2>
  )
};
