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
    return (React.createElement(Card, { className: `
          ${styles.editableCard}
          ${props.minimal ? styles.editableCardMinimal : ''}
          ${props.selected ? styles.editableCardSelected : ''}
          ${props.extended ? styles.editableCardExtended : ''}
          ${props.onSelect ? styles.editableCardSelectable : ''}
          ${props.onDelete ? styles.editableCardDeletable : ''}
        `, onClick: props.onSelect },
        props.icon
            ? React.createElement(React.Fragment, null,
                React.createElement(Icon, { icon: props.icon }),
                "\u2002")
            : null,
        React.createElement(Text, { ellipsize: true }, props.children),
        props.onDelete
            ? React.createElement(Button, { onClick: (evt) => {
                    props.onDelete ? props.onDelete() : void 0;
                    evt.stopPropagation();
                    return false;
                }, intent: "danger", icon: "delete", title: "Delete this item", className: styles.editableCardDeleteButton, minimal: true, small: true })
            : null));
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvcmVuZGVyZXIvd2lkZ2V0cy9lZGl0YWJsZS1jYXJkLWxpc3QvaW5kZXgudHN4Il0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sS0FBSyxNQUFNLE9BQU8sQ0FBQztBQUMxQixPQUFPLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLE1BQU0sbUJBQW1CLENBQUM7QUFFN0QsT0FBTyxNQUFNLE1BQU0sZUFBZSxDQUFDO0FBVW5DLE1BQU0sQ0FBQyxNQUFNLGNBQWMsR0FBa0MsVUFBVSxFQUFFLE9BQU8sRUFBRSxTQUFTLEVBQUUsS0FBSyxFQUFFO0lBQ2xHLE9BQU8sQ0FDTCw2QkFBSyxTQUFTLEVBQUUsTUFBTSxDQUFDLHVCQUF1QjtRQUM1QyxvQkFBQyxvQkFBb0IsSUFBQyxPQUFPLEVBQUUsT0FBTyxFQUFFLFNBQVMsRUFBRSxTQUFTLEVBQUUsS0FBSyxFQUFFLEtBQUssR0FBSSxDQUMxRSxDQUNQLENBQUM7QUFDSixDQUFDLENBQUM7QUFHRixnR0FBZ0c7QUFDaEcsTUFBTSxDQUFDLE1BQU0sb0JBQW9CLEdBQWtDLFVBQVUsRUFBRSxPQUFPLEVBQUUsU0FBUyxFQUFFLEtBQUssRUFBRTtJQUN4RyxPQUFPLG9CQUFDLE1BQU0sSUFDWixJQUFJLEVBQUMsTUFBTSxFQUNYLE9BQU8sRUFBRSxPQUFPLEVBQ2hCLElBQUksRUFBRSxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxJQUFJLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLEVBQ2xELE9BQU8sRUFBRSxTQUFTLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsU0FBUyxFQUNyQyxLQUFLLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsUUFBUSxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFDcEMsTUFBTSxFQUFFLFNBQVMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQyxTQUFTLEVBQ3pDLFNBQVMsRUFBRSxHQUFHLE1BQU0sQ0FBQyxjQUFjLElBQUksU0FBUyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMseUJBQXlCLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxHQUMxRixDQUFDO0FBQ0wsQ0FBQyxDQUFDO0FBV0YsTUFBTSxDQUFDLE1BQU0sa0JBQWtCLEdBQXNDLFVBQVUsS0FBSztJQUNsRixPQUFPLENBQ0wsb0JBQUMsSUFBSSxJQUNELFNBQVMsRUFBRTtZQUNQLE1BQU0sQ0FBQyxZQUFZO1lBQ25CLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDLENBQUMsRUFBRTtZQUMvQyxLQUFLLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsb0JBQW9CLENBQUMsQ0FBQyxDQUFDLEVBQUU7WUFDakQsS0FBSyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLG9CQUFvQixDQUFDLENBQUMsQ0FBQyxFQUFFO1lBQ2pELEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDLENBQUMsRUFBRTtZQUNuRCxLQUFLLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMscUJBQXFCLENBQUMsQ0FBQyxDQUFDLEVBQUU7U0FDckQsRUFDRCxPQUFPLEVBQUUsS0FBSyxDQUFDLFFBQVE7UUFFeEIsS0FBSyxDQUFDLElBQUk7WUFDVCxDQUFDLENBQUM7Z0JBQUUsb0JBQUMsSUFBSSxJQUFDLElBQUksRUFBRSxLQUFLLENBQUMsSUFBSSxHQUFJO3lCQUFTO1lBQ3ZDLENBQUMsQ0FBQyxJQUFJO1FBRVIsb0JBQUMsSUFBSSxJQUFDLFNBQVMsRUFBRSxJQUFJLElBQ2xCLEtBQUssQ0FBQyxRQUFRLENBQ1Y7UUFFTixLQUFLLENBQUMsUUFBUTtZQUNiLENBQUMsQ0FBQyxvQkFBQyxNQUFNLElBQ0wsT0FBTyxFQUFFLENBQUMsR0FBUSxFQUFFLEVBQUU7b0JBQ3BCLEtBQUssQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxRQUFRLEVBQUUsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUM7b0JBQzNDLEdBQUcsQ0FBQyxlQUFlLEVBQUUsQ0FBQztvQkFDdEIsT0FBTyxLQUFLLENBQUM7Z0JBQ2YsQ0FBQyxFQUNELE1BQU0sRUFBQyxRQUFRLEVBQ2YsSUFBSSxFQUFDLFFBQVEsRUFDYixLQUFLLEVBQUMsa0JBQWtCLEVBQ3hCLFNBQVMsRUFBRSxNQUFNLENBQUMsd0JBQXdCLEVBQzFDLE9BQU8sRUFBRSxJQUFJLEVBQ2IsS0FBSyxFQUFFLElBQUksR0FDWDtZQUNKLENBQUMsQ0FBQyxJQUFJLENBRUgsQ0FDUixDQUFDO0FBQ0osQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IFJlYWN0IGZyb20gJ3JlYWN0JztcbmltcG9ydCB7IEljb24sIENhcmQsIFRleHQsIEJ1dHRvbiB9IGZyb20gJ0BibHVlcHJpbnRqcy9jb3JlJztcbmltcG9ydCB7IEljb25OYW1lIH0gZnJvbSAnQGJsdWVwcmludGpzL2ljb25zJztcbmltcG9ydCBzdHlsZXMgZnJvbSAnLi9zdHlsZXMuc2Nzcyc7XG5cblxuaW50ZXJmYWNlIEFkZENhcmRUcmlnZ2VyUHJvcHMge1xuICBvbkNsaWNrPzogKC4uLmFyZ3M6IGFueVtdKSA9PiB2b2lkLFxuICBoaWdobGlnaHQ/OiBib29sZWFuLFxuICBsYWJlbD86IHN0cmluZyB8IEpTWC5FbGVtZW50LFxufVxuXG5cbmV4cG9ydCBjb25zdCBBZGRDYXJkVHJpZ2dlcjogUmVhY3QuRkM8QWRkQ2FyZFRyaWdnZXJQcm9wcz4gPSBmdW5jdGlvbiAoeyBvbkNsaWNrLCBoaWdobGlnaHQsIGxhYmVsIH0pIHtcbiAgcmV0dXJuIChcbiAgICA8ZGl2IGNsYXNzTmFtZT17c3R5bGVzLmFkZENhcmRUcmlnZ2VyQ29udGFpbmVyfT5cbiAgICAgIDxBZGRDYXJkVHJpZ2dlckJ1dHRvbiBvbkNsaWNrPXtvbkNsaWNrfSBoaWdobGlnaHQ9e2hpZ2hsaWdodH0gbGFiZWw9e2xhYmVsfSAvPlxuICAgIDwvZGl2PlxuICApO1xufTtcblxuXG4vLyBJZiB1c2luZyBzZXBhcmF0ZWx5IGZyb20gQWRkQ2FyZFRyaWdnZXIsIHdyYXAgaW50byBlbGVtZW50IHdpdGggYWRkQ2FyZFRyaWdnZXJDb250YWluZXIgY2xhc3NcbmV4cG9ydCBjb25zdCBBZGRDYXJkVHJpZ2dlckJ1dHRvbjogUmVhY3QuRkM8QWRkQ2FyZFRyaWdnZXJQcm9wcz4gPSBmdW5jdGlvbiAoeyBvbkNsaWNrLCBoaWdobGlnaHQsIGxhYmVsIH0pIHtcbiAgcmV0dXJuIDxCdXR0b25cbiAgICBpY29uPVwicGx1c1wiXG4gICAgb25DbGljaz17b25DbGlja31cbiAgICB0ZXh0PXtoaWdobGlnaHQgPyAobGFiZWwgfHwgdW5kZWZpbmVkKSA6IHVuZGVmaW5lZH1cbiAgICBtaW5pbWFsPXtoaWdobGlnaHQgPyB0cnVlIDogdW5kZWZpbmVkfVxuICAgIHRpdGxlPXtsYWJlbCA/IGxhYmVsLnRvU3RyaW5nKCkgOiBcIlwifVxuICAgIGludGVudD17aGlnaGxpZ2h0ID8gXCJwcmltYXJ5XCIgOiB1bmRlZmluZWR9XG4gICAgY2xhc3NOYW1lPXtgJHtzdHlsZXMuYWRkQ2FyZFRyaWdnZXJ9ICR7aGlnaGxpZ2h0ID8gc3R5bGVzLmFkZENhcmRUcmlnZ2VySGlnaGxpZ2h0ZWQgOiAnJ31gfVxuICAvPjtcbn07XG5cblxuaW50ZXJmYWNlIFNpbXBsZUVkaXRhYmxlQ2FyZFByb3BzIHtcbiAgaWNvbj86IEljb25OYW1lLFxuICBzZWxlY3RlZD86IGJvb2xlYW4sXG4gIG9uRGVsZXRlPzogKCkgPT4gdm9pZCxcbiAgb25TZWxlY3Q/OiAoKSA9PiB2b2lkLFxuICBtaW5pbWFsPzogYm9vbGVhbixcbiAgZXh0ZW5kZWQ/OiBib29sZWFuLFxufVxuZXhwb3J0IGNvbnN0IFNpbXBsZUVkaXRhYmxlQ2FyZDogUmVhY3QuRkM8U2ltcGxlRWRpdGFibGVDYXJkUHJvcHM+ID0gZnVuY3Rpb24gKHByb3BzKSB7XG4gIHJldHVybiAoXG4gICAgPENhcmRcbiAgICAgICAgY2xhc3NOYW1lPXtgXG4gICAgICAgICAgJHtzdHlsZXMuZWRpdGFibGVDYXJkfVxuICAgICAgICAgICR7cHJvcHMubWluaW1hbCA/IHN0eWxlcy5lZGl0YWJsZUNhcmRNaW5pbWFsIDogJyd9XG4gICAgICAgICAgJHtwcm9wcy5zZWxlY3RlZCA/IHN0eWxlcy5lZGl0YWJsZUNhcmRTZWxlY3RlZCA6ICcnfVxuICAgICAgICAgICR7cHJvcHMuZXh0ZW5kZWQgPyBzdHlsZXMuZWRpdGFibGVDYXJkRXh0ZW5kZWQgOiAnJ31cbiAgICAgICAgICAke3Byb3BzLm9uU2VsZWN0ID8gc3R5bGVzLmVkaXRhYmxlQ2FyZFNlbGVjdGFibGUgOiAnJ31cbiAgICAgICAgICAke3Byb3BzLm9uRGVsZXRlID8gc3R5bGVzLmVkaXRhYmxlQ2FyZERlbGV0YWJsZSA6ICcnfVxuICAgICAgICBgfVxuICAgICAgICBvbkNsaWNrPXtwcm9wcy5vblNlbGVjdH0+XG5cbiAgICAgIHtwcm9wcy5pY29uXG4gICAgICAgID8gPD48SWNvbiBpY29uPXtwcm9wcy5pY29ufSAvPiZlbnNwOzwvPlxuICAgICAgICA6IG51bGx9XG5cbiAgICAgIDxUZXh0IGVsbGlwc2l6ZT17dHJ1ZX0+XG4gICAgICAgIHtwcm9wcy5jaGlsZHJlbn1cbiAgICAgIDwvVGV4dD5cblxuICAgICAge3Byb3BzLm9uRGVsZXRlXG4gICAgICAgID8gPEJ1dHRvblxuICAgICAgICAgICAgb25DbGljaz17KGV2dDogYW55KSA9PiB7XG4gICAgICAgICAgICAgIHByb3BzLm9uRGVsZXRlID8gcHJvcHMub25EZWxldGUoKSA6IHZvaWQgMDtcbiAgICAgICAgICAgICAgZXZ0LnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICB9fVxuICAgICAgICAgICAgaW50ZW50PVwiZGFuZ2VyXCJcbiAgICAgICAgICAgIGljb249XCJkZWxldGVcIlxuICAgICAgICAgICAgdGl0bGU9XCJEZWxldGUgdGhpcyBpdGVtXCJcbiAgICAgICAgICAgIGNsYXNzTmFtZT17c3R5bGVzLmVkaXRhYmxlQ2FyZERlbGV0ZUJ1dHRvbn1cbiAgICAgICAgICAgIG1pbmltYWw9e3RydWV9XG4gICAgICAgICAgICBzbWFsbD17dHJ1ZX1cbiAgICAgICAgICAvPlxuICAgICAgICA6IG51bGx9XG5cbiAgICA8L0NhcmQ+XG4gICk7XG59O1xuIl19