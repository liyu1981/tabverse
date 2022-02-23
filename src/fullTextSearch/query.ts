import { typeGuard } from '../global';

export interface QueryScope {
  type?: string;
  field?: string;
}

export type QueryScopeMap = { [name: string]: QueryScope };

export interface AndQuery {
  scope: QueryScope;
  terms: string[];
}

export interface OrQuery {
  andQueries: AndQuery[];
}

export const TYPE_ALL = '__all';
export const FIELD_ALL = '__all';

export class Query implements OrQuery {
  andQueries: AndQuery[];

  constructor(q: OrQuery | AndQuery) {
    if (typeGuard<OrQuery>(q)) {
      this.andQueries = q.andQueries.slice(0);
    } else if (typeGuard<AndQuery>(q)) {
      this.andQueries = [q];
    }
  }

  toJSON(): OrQuery {
    return { andQueries: this.andQueries };
  }

  isEmpty(): boolean {
    if (this.andQueries.length <= 0) {
      return true;
    }
    const s = this.andQueries.reduce((sum, and) => sum + and.terms.length, 0);
    if (s === 0) {
      return true;
    }

    return false;
  }

  addAndQuery(terms: string[], scope: QueryScope) {
    const newQ = new Query(this);
    const newAndQuery = {
      scope,
      terms: terms.map((term) => term.toLowerCase()),
    };
    newQ.andQueries = this.andQueries.concat([newAndQuery]);
    return newQ;
  }

  removeAndQuery(index: number) {
    const newQ = new Query(this);
    newQ.andQueries = this.andQueries.filter((_v, i) => i !== index);
    return newQ;
  }

  replaceAndQuery(index: number, newAndQuery: AndQuery) {
    const newQ = new Query(this);
    newQ.andQueries[index] = newAndQuery;
    return newQ;
  }

  changeScope(andQueryIndex: number, newScope: QueryScope): Query {
    const newQ = new Query(this);
    const oldAndQuery = this.andQueries[andQueryIndex];
    newQ.andQueries[andQueryIndex] = {
      scope: newScope,
      terms: oldAndQuery.terms,
    };
    return newQ;
  }
}

export const EmptyQuery = new Query({ andQueries: [] });
