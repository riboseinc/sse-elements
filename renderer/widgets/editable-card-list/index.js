import React from 'react';
import { Icon, Card, Text, Button } from '@blueprintjs/core';
import styles from './styles.scss';
export const AddCardTrigger = function ({ onClick, highlight, label }) {
    return (React.createElement("div", { className: styles.addCardTriggerContainer },
        React.createElement(AddCardTriggerButton, { onClick: onClick, highlight: highlight, label: label })));
};
// If using separately from AddCardTrigger, wrap into element with addCardTriggerContainer class
export const AddCardTriggerButton = function ({ onClick, highlight, label }) {
    return React.createElement(Button, { icon: "plus", onClick: onClick, text: highlight ? (label || undefined) : undefined, minimal: highlight ? true : undefined, title: label ? label.toString() : "", intent: highlight ? "primary" : undefined, className: `${styles.addCardTrigger} ${highlight ? styles.addCardTriggerHighlighted : ''}` });
};
export const SimpleEditableCard = function (props) {
    let contents;
    const contentsClassName = `${styles.cardContents} ${props.contentsClassName || ''}`;
    if (props.extended) {
        contents = React.createElement("div", { className: contentsClassName }, props.children);
    }
    else {
        contents = (React.createElement(Text, { ellipsize: true, className: contentsClassName }, props.children));
    }
    return (React.createElement(Card, { className: `
          ${styles.editableCard}
          ${props.minimal ? styles.editableCardMinimal : ''}
          ${props.selected ? styles.editableCardSelected : ''}
          ${props.extended ? styles.editableCardExtended : ''}
          ${props.onSelect ? styles.editableCardSelectable : ''}
          ${props.onClick ? styles.editableCardInteractive : ''}
          ${props.onDelete ? styles.editableCardDeletable : ''}
          ${props.className || ''}
        `, onClick: props.onClick || props.onSelect },
        props.icon
            ? React.createElement(React.Fragment, null,
                React.createElement(Icon, { icon: props.icon }),
                "\u2002")
            : null,
        contents,
        props.onDelete
            ? React.createElement(Button, { onClick: (evt) => {
                    props.onDelete ? props.onDelete() : void 0;
                    evt.stopPropagation();
                    return false;
                }, intent: "danger", icon: "delete", title: "Delete this item", className: styles.editableCardDeleteButton, minimal: true, small: true })
            : null));
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvcmVuZGVyZXIvd2lkZ2V0cy9lZGl0YWJsZS1jYXJkLWxpc3QvaW5kZXgudHN4Il0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sS0FBSyxNQUFNLE9BQU8sQ0FBQztBQUMxQixPQUFPLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLE1BQU0sbUJBQW1CLENBQUM7QUFFN0QsT0FBTyxNQUFNLE1BQU0sZUFBZSxDQUFDO0FBVW5DLE1BQU0sQ0FBQyxNQUFNLGNBQWMsR0FBa0MsVUFBVSxFQUFFLE9BQU8sRUFBRSxTQUFTLEVBQUUsS0FBSyxFQUFFO0lBQ2xHLE9BQU8sQ0FDTCw2QkFBSyxTQUFTLEVBQUUsTUFBTSxDQUFDLHVCQUF1QjtRQUM1QyxvQkFBQyxvQkFBb0IsSUFBQyxPQUFPLEVBQUUsT0FBTyxFQUFFLFNBQVMsRUFBRSxTQUFTLEVBQUUsS0FBSyxFQUFFLEtBQUssR0FBSSxDQUMxRSxDQUNQLENBQUM7QUFDSixDQUFDLENBQUM7QUFHRixnR0FBZ0c7QUFDaEcsTUFBTSxDQUFDLE1BQU0sb0JBQW9CLEdBQWtDLFVBQVUsRUFBRSxPQUFPLEVBQUUsU0FBUyxFQUFFLEtBQUssRUFBRTtJQUN4RyxPQUFPLG9CQUFDLE1BQU0sSUFDWixJQUFJLEVBQUMsTUFBTSxFQUNYLE9BQU8sRUFBRSxPQUFPLEVBQ2hCLElBQUksRUFBRSxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxJQUFJLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLEVBQ2xELE9BQU8sRUFBRSxTQUFTLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsU0FBUyxFQUNyQyxLQUFLLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsUUFBUSxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFDcEMsTUFBTSxFQUFFLFNBQVMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxTQUFTLEVBQ3pDLFNBQVMsRUFBRSxHQUFHLE1BQU0sQ0FBQyxjQUFjLElBQUksU0FBUyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMseUJBQXlCLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxHQUMxRixDQUFDO0FBQ0wsQ0FBQyxDQUFDO0FBY0YsTUFBTSxDQUFDLE1BQU0sa0JBQWtCLEdBQXNDLFVBQVUsS0FBSztJQUNsRixJQUFJLFFBQXFCLENBQUM7SUFDMUIsTUFBTSxpQkFBaUIsR0FBRyxHQUFHLE1BQU0sQ0FBQyxZQUFZLElBQUksS0FBSyxDQUFDLGlCQUFpQixJQUFJLEVBQUUsRUFBRSxDQUFDO0lBRXBGLElBQUksS0FBSyxDQUFDLFFBQVEsRUFBRTtRQUNsQixRQUFRLEdBQUcsNkJBQUssU0FBUyxFQUFFLGlCQUFpQixJQUFHLEtBQUssQ0FBQyxRQUFRLENBQU8sQ0FBQztLQUN0RTtTQUFNO1FBQ0wsUUFBUSxHQUFHLENBQ1Qsb0JBQUMsSUFBSSxJQUFDLFNBQVMsRUFBRSxJQUFJLEVBQUUsU0FBUyxFQUFFLGlCQUFpQixJQUNoRCxLQUFLLENBQUMsUUFBUSxDQUNWLENBQ1IsQ0FBQztLQUNIO0lBRUQsT0FBTyxDQUNMLG9CQUFDLElBQUksSUFDRCxTQUFTLEVBQUU7WUFDUCxNQUFNLENBQUMsWUFBWTtZQUNuQixLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxDQUFDLEVBQUU7WUFDL0MsS0FBSyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLG9CQUFvQixDQUFDLENBQUMsQ0FBQyxFQUFFO1lBQ2pELEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLENBQUMsRUFBRTtZQUNqRCxLQUFLLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsc0JBQXNCLENBQUMsQ0FBQyxDQUFDLEVBQUU7WUFDbkQsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLHVCQUF1QixDQUFDLENBQUMsQ0FBQyxFQUFFO1lBQ25ELEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLENBQUMsRUFBRTtZQUNsRCxLQUFLLENBQUMsU0FBUyxJQUFJLEVBQUU7U0FDeEIsRUFDRCxPQUFPLEVBQUUsS0FBSyxDQUFDLE9BQU8sSUFBSSxLQUFLLENBQUMsUUFBUTtRQUV6QyxLQUFLLENBQUMsSUFBSTtZQUNULENBQUMsQ0FBQztnQkFBRSxvQkFBQyxJQUFJLElBQUMsSUFBSSxFQUFFLEtBQUssQ0FBQyxJQUFJLEdBQUk7eUJBQVM7WUFDdkMsQ0FBQyxDQUFDLElBQUk7UUFFUCxRQUFRO1FBRVIsS0FBSyxDQUFDLFFBQVE7WUFDYixDQUFDLENBQUMsb0JBQUMsTUFBTSxJQUNMLE9BQU8sRUFBRSxDQUFDLEdBQVEsRUFBRSxFQUFFO29CQUNwQixLQUFLLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsUUFBUSxFQUFFLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDO29CQUMzQyxHQUFHLENBQUMsZUFBZSxFQUFFLENBQUM7b0JBQ3RCLE9BQU8sS0FBSyxDQUFDO2dCQUNmLENBQUMsRUFDRCxNQUFNLEVBQUMsUUFBUSxFQUNmLElBQUksRUFBQyxRQUFRLEVBQ2IsS0FBSyxFQUFDLGtCQUFrQixFQUN4QixTQUFTLEVBQUUsTUFBTSxDQUFDLHdCQUF3QixFQUMxQyxPQUFPLEVBQUUsSUFBSSxFQUNiLEtBQUssRUFBRSxJQUFJLEdBQ1g7WUFDSixDQUFDLENBQUMsSUFBSSxDQUVILENBQ1IsQ0FBQztBQUNKLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBSZWFjdCBmcm9tICdyZWFjdCc7XG5pbXBvcnQgeyBJY29uLCBDYXJkLCBUZXh0LCBCdXR0b24gfSBmcm9tICdAYmx1ZXByaW50anMvY29yZSc7XG5pbXBvcnQgeyBJY29uTmFtZSB9IGZyb20gJ0BibHVlcHJpbnRqcy9pY29ucyc7XG5pbXBvcnQgc3R5bGVzIGZyb20gJy4vc3R5bGVzLnNjc3MnO1xuXG5cbmludGVyZmFjZSBBZGRDYXJkVHJpZ2dlclByb3BzIHtcbiAgb25DbGljaz86ICguLi5hcmdzOiBhbnlbXSkgPT4gdm9pZCxcbiAgaGlnaGxpZ2h0PzogYm9vbGVhbixcbiAgbGFiZWw/OiBzdHJpbmcgfCBKU1guRWxlbWVudCxcbn1cblxuXG5leHBvcnQgY29uc3QgQWRkQ2FyZFRyaWdnZXI6IFJlYWN0LkZDPEFkZENhcmRUcmlnZ2VyUHJvcHM+ID0gZnVuY3Rpb24gKHsgb25DbGljaywgaGlnaGxpZ2h0LCBsYWJlbCB9KSB7XG4gIHJldHVybiAoXG4gICAgPGRpdiBjbGFzc05hbWU9e3N0eWxlcy5hZGRDYXJkVHJpZ2dlckNvbnRhaW5lcn0+XG4gICAgICA8QWRkQ2FyZFRyaWdnZXJCdXR0b24gb25DbGljaz17b25DbGlja30gaGlnaGxpZ2h0PXtoaWdobGlnaHR9IGxhYmVsPXtsYWJlbH0gLz5cbiAgICA8L2Rpdj5cbiAgKTtcbn07XG5cblxuLy8gSWYgdXNpbmcgc2VwYXJhdGVseSBmcm9tIEFkZENhcmRUcmlnZ2VyLCB3cmFwIGludG8gZWxlbWVudCB3aXRoIGFkZENhcmRUcmlnZ2VyQ29udGFpbmVyIGNsYXNzXG5leHBvcnQgY29uc3QgQWRkQ2FyZFRyaWdnZXJCdXR0b246IFJlYWN0LkZDPEFkZENhcmRUcmlnZ2VyUHJvcHM+ID0gZnVuY3Rpb24gKHsgb25DbGljaywgaGlnaGxpZ2h0LCBsYWJlbCB9KSB7XG4gIHJldHVybiA8QnV0dG9uXG4gICAgaWNvbj1cInBsdXNcIlxuICAgIG9uQ2xpY2s9e29uQ2xpY2t9XG4gICAgdGV4dD17aGlnaGxpZ2h0ID8gKGxhYmVsIHx8IHVuZGVmaW5lZCkgOiB1bmRlZmluZWR9XG4gICAgbWluaW1hbD17aGlnaGxpZ2h0ID8gdHJ1ZSA6IHVuZGVmaW5lZH1cbiAgICB0aXRsZT17bGFiZWwgPyBsYWJlbC50b1N0cmluZygpIDogXCJcIn1cbiAgICBpbnRlbnQ9e2hpZ2hsaWdodCA/IFwicHJpbWFyeVwiIDogdW5kZWZpbmVkfVxuICAgIGNsYXNzTmFtZT17YCR7c3R5bGVzLmFkZENhcmRUcmlnZ2VyfSAke2hpZ2hsaWdodCA/IHN0eWxlcy5hZGRDYXJkVHJpZ2dlckhpZ2hsaWdodGVkIDogJyd9YH1cbiAgLz47XG59O1xuXG5cbmludGVyZmFjZSBTaW1wbGVFZGl0YWJsZUNhcmRQcm9wcyB7XG4gIGljb24/OiBJY29uTmFtZSxcbiAgc2VsZWN0ZWQ/OiBib29sZWFuLFxuICBvbkRlbGV0ZT86ICgpID0+IHZvaWQsXG4gIG9uU2VsZWN0PzogKCkgPT4gdm9pZCxcbiAgb25DbGljaz86ICgpID0+IHZvaWQsXG4gIG1pbmltYWw/OiBib29sZWFuLFxuICBleHRlbmRlZD86IGJvb2xlYW4sXG4gIGNvbnRlbnRzQ2xhc3NOYW1lPzogc3RyaW5nLFxuICBjbGFzc05hbWU/OiBzdHJpbmcsXG59XG5leHBvcnQgY29uc3QgU2ltcGxlRWRpdGFibGVDYXJkOiBSZWFjdC5GQzxTaW1wbGVFZGl0YWJsZUNhcmRQcm9wcz4gPSBmdW5jdGlvbiAocHJvcHMpIHtcbiAgbGV0IGNvbnRlbnRzOiBKU1guRWxlbWVudDtcbiAgY29uc3QgY29udGVudHNDbGFzc05hbWUgPSBgJHtzdHlsZXMuY2FyZENvbnRlbnRzfSAke3Byb3BzLmNvbnRlbnRzQ2xhc3NOYW1lIHx8ICcnfWA7XG5cbiAgaWYgKHByb3BzLmV4dGVuZGVkKSB7XG4gICAgY29udGVudHMgPSA8ZGl2IGNsYXNzTmFtZT17Y29udGVudHNDbGFzc05hbWV9Pntwcm9wcy5jaGlsZHJlbn08L2Rpdj47XG4gIH0gZWxzZSB7XG4gICAgY29udGVudHMgPSAoXG4gICAgICA8VGV4dCBlbGxpcHNpemU9e3RydWV9IGNsYXNzTmFtZT17Y29udGVudHNDbGFzc05hbWV9PlxuICAgICAgICB7cHJvcHMuY2hpbGRyZW59XG4gICAgICA8L1RleHQ+XG4gICAgKTtcbiAgfVxuXG4gIHJldHVybiAoXG4gICAgPENhcmRcbiAgICAgICAgY2xhc3NOYW1lPXtgXG4gICAgICAgICAgJHtzdHlsZXMuZWRpdGFibGVDYXJkfVxuICAgICAgICAgICR7cHJvcHMubWluaW1hbCA/IHN0eWxlcy5lZGl0YWJsZUNhcmRNaW5pbWFsIDogJyd9XG4gICAgICAgICAgJHtwcm9wcy5zZWxlY3RlZCA/IHN0eWxlcy5lZGl0YWJsZUNhcmRTZWxlY3RlZCA6ICcnfVxuICAgICAgICAgICR7cHJvcHMuZXh0ZW5kZWQgPyBzdHlsZXMuZWRpdGFibGVDYXJkRXh0ZW5kZWQgOiAnJ31cbiAgICAgICAgICAke3Byb3BzLm9uU2VsZWN0ID8gc3R5bGVzLmVkaXRhYmxlQ2FyZFNlbGVjdGFibGUgOiAnJ31cbiAgICAgICAgICAke3Byb3BzLm9uQ2xpY2sgPyBzdHlsZXMuZWRpdGFibGVDYXJkSW50ZXJhY3RpdmUgOiAnJ31cbiAgICAgICAgICAke3Byb3BzLm9uRGVsZXRlID8gc3R5bGVzLmVkaXRhYmxlQ2FyZERlbGV0YWJsZSA6ICcnfVxuICAgICAgICAgICR7cHJvcHMuY2xhc3NOYW1lIHx8ICcnfVxuICAgICAgICBgfVxuICAgICAgICBvbkNsaWNrPXtwcm9wcy5vbkNsaWNrIHx8IHByb3BzLm9uU2VsZWN0fT5cblxuICAgICAge3Byb3BzLmljb25cbiAgICAgICAgPyA8PjxJY29uIGljb249e3Byb3BzLmljb259IC8+JmVuc3A7PC8+XG4gICAgICAgIDogbnVsbH1cblxuICAgICAge2NvbnRlbnRzfVxuXG4gICAgICB7cHJvcHMub25EZWxldGVcbiAgICAgICAgPyA8QnV0dG9uXG4gICAgICAgICAgICBvbkNsaWNrPXsoZXZ0OiBhbnkpID0+IHtcbiAgICAgICAgICAgICAgcHJvcHMub25EZWxldGUgPyBwcm9wcy5vbkRlbGV0ZSgpIDogdm9pZCAwO1xuICAgICAgICAgICAgICBldnQuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIH19XG4gICAgICAgICAgICBpbnRlbnQ9XCJkYW5nZXJcIlxuICAgICAgICAgICAgaWNvbj1cImRlbGV0ZVwiXG4gICAgICAgICAgICB0aXRsZT1cIkRlbGV0ZSB0aGlzIGl0ZW1cIlxuICAgICAgICAgICAgY2xhc3NOYW1lPXtzdHlsZXMuZWRpdGFibGVDYXJkRGVsZXRlQnV0dG9ufVxuICAgICAgICAgICAgbWluaW1hbD17dHJ1ZX1cbiAgICAgICAgICAgIHNtYWxsPXt0cnVlfVxuICAgICAgICAgIC8+XG4gICAgICAgIDogbnVsbH1cblxuICAgIDwvQ2FyZD5cbiAgKTtcbn07XG4iXX0=