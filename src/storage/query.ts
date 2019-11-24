export interface IndexableObject<IDType = any> {
  /* An indexable object is an object that has at least an `id` property
     alongside whatever else fields describe that object.

     May be more appropriately named ContentType. */

  id: IDType,
  [fieldMame: string]: any,
}


export interface Index<T extends IndexableObject<any>> {
  /* An index is a simple object
     where each key is a stringified value of some property of object T,
     and the value is assigned the corresponding object instance
     for direct access.

     The property in question must obviously not have duplicate values
     across all objects. */

  [stringifiedFieldValue: string]: T,
}


interface ArraySorter { (a: [string, unknown], b: [string, unknown]): number }


export class QuerySet<T extends IndexableObject> {
  /* Simplifies some operations on indexes, like a mini-pseudo-ORM. */

  index: Index<T>;
  order: ArraySorter;
  items: [string, T][];
  _ordered: boolean;

  constructor(
      index: Index<T>,
      order: ArraySorter = sortAlphabeticallyAscending,
      items: [string, T][] | undefined = undefined,
      ordered = false) {
    this.index = index;
    this.items = items === undefined ? Object.entries(index) : items;
    this.order = order;
    this._ordered = ordered;
  }
  get(id: string): T {
    return this.index[id];
  }
  add(obj: T): void {
    this.index[obj.id] = obj;
  }
  orderBy(comparison: ArraySorter) {
    return new QuerySet(this.index, this.order, [...this.items].sort(comparison), true);
  }
  filter(func: (item: [string, T]) => boolean) {
    return new QuerySet(this.index, this.order, this.items.filter(func), this._ordered);
  }
  all() {
    return this._ordered
      ? this.items.map(item => item[1])
      : this.orderBy(this.order).items.map(item => item[1]);
  }
}



export const sortAlphabeticallyAscending: ArraySorter = function (a, b) {
  return a[0].localeCompare(b[0]);
}
export const sortIntegerDescending: ArraySorter = function (a: [string, unknown], b: [string, unknown]): number {
  return parseInt(b[0], 10) - parseInt(a[0], 10);
}
export const sortIntegerAscending: ArraySorter = function (a: [string, unknown], b: [string, unknown]): number {
  return parseInt(a[0], 10) - parseInt(b[0], 10);
}
