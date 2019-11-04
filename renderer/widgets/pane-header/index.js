import React from 'react';
import styles from './styles.scss';
export const PaneHeader = function (props) {
    let alignmentClass;
    if (props.align === 'left') {
        alignmentClass = styles.paneHeaderAlignedLeft;
    }
    else if (props.align === 'right') {
        alignmentClass = styles.paneHeaderAlignedRight;
    }
    else {
        alignmentClass = '';
    }
    return (React.createElement("h2", { className: `
      ${styles.paneHeader}
      ${alignmentClass}
      ${props.className ? props.className : ''}
      ${props.loud ? styles.paneHeaderLoud : ''}
    ` }, props.children));
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvcmVuZGVyZXIvd2lkZ2V0cy9wYW5lLWhlYWRlci9pbmRleC50c3giXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsT0FBTyxLQUFLLE1BQU0sT0FBTyxDQUFDO0FBQzFCLE9BQU8sTUFBTSxNQUFNLGVBQWUsQ0FBQztBQVFuQyxNQUFNLENBQUMsTUFBTSxVQUFVLEdBQThCLFVBQVUsS0FBSztJQUNsRSxJQUFJLGNBQXNCLENBQUM7SUFDM0IsSUFBSSxLQUFLLENBQUMsS0FBSyxLQUFLLE1BQU0sRUFBRTtRQUMxQixjQUFjLEdBQUcsTUFBTSxDQUFDLHFCQUFxQixDQUFDO0tBQy9DO1NBQU0sSUFBSSxLQUFLLENBQUMsS0FBSyxLQUFLLE9BQU8sRUFBRTtRQUNsQyxjQUFjLEdBQUcsTUFBTSxDQUFDLHNCQUFzQixDQUFDO0tBQ2hEO1NBQU07UUFDTCxjQUFjLEdBQUcsRUFBRSxDQUFDO0tBQ3JCO0lBRUQsT0FBTyxDQUNMLDRCQUFJLFNBQVMsRUFBRTtRQUNYLE1BQU0sQ0FBQyxVQUFVO1FBQ2pCLGNBQWM7UUFDZCxLQUFLLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxFQUFFO1FBQ3RDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxjQUFjLENBQUMsQ0FBQyxDQUFDLEVBQUU7S0FDMUMsSUFBRyxLQUFLLENBQUMsUUFBUSxDQUFNLENBQ3pCLENBQUE7QUFDSCxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgUmVhY3QgZnJvbSAncmVhY3QnO1xuaW1wb3J0IHN0eWxlcyBmcm9tICcuL3N0eWxlcy5zY3NzJztcblxuXG5pbnRlcmZhY2UgUGFuZUhlYWRlclByb3BzIHtcbiAgbG91ZD86IGJvb2xlYW4sXG4gIGFsaWduPzogJ2xlZnQnIHwgJ3JpZ2h0JyxcbiAgY2xhc3NOYW1lPzogc3RyaW5nLFxufVxuZXhwb3J0IGNvbnN0IFBhbmVIZWFkZXI6IFJlYWN0LkZDPFBhbmVIZWFkZXJQcm9wcz4gPSBmdW5jdGlvbiAocHJvcHMpIHtcbiAgbGV0IGFsaWdubWVudENsYXNzOiBzdHJpbmc7XG4gIGlmIChwcm9wcy5hbGlnbiA9PT0gJ2xlZnQnKSB7XG4gICAgYWxpZ25tZW50Q2xhc3MgPSBzdHlsZXMucGFuZUhlYWRlckFsaWduZWRMZWZ0O1xuICB9IGVsc2UgaWYgKHByb3BzLmFsaWduID09PSAncmlnaHQnKSB7XG4gICAgYWxpZ25tZW50Q2xhc3MgPSBzdHlsZXMucGFuZUhlYWRlckFsaWduZWRSaWdodDtcbiAgfSBlbHNlIHtcbiAgICBhbGlnbm1lbnRDbGFzcyA9ICcnO1xuICB9XG5cbiAgcmV0dXJuIChcbiAgICA8aDIgY2xhc3NOYW1lPXtgXG4gICAgICAke3N0eWxlcy5wYW5lSGVhZGVyfVxuICAgICAgJHthbGlnbm1lbnRDbGFzc31cbiAgICAgICR7cHJvcHMuY2xhc3NOYW1lID8gcHJvcHMuY2xhc3NOYW1lIDogJyd9XG4gICAgICAke3Byb3BzLmxvdWQgPyBzdHlsZXMucGFuZUhlYWRlckxvdWQgOiAnJ31cbiAgICBgfT57cHJvcHMuY2hpbGRyZW59PC9oMj5cbiAgKVxufTtcbiJdfQ==