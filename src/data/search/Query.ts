import { typeGuard } from '../../global';

/**
 * The query model behind the search box: an OR of AND-groups.
 *
 * Typing "foo bar" and pressing Enter adds one group whose terms must all
 * match the same record; adding a second tag ORs the two groups. Every group
 * carries a scope ({ type, field }) that narrows what it looks at - the
 * scopeMap in the UI decides which scopes the user can pick.
 *
 * This is the only thing that survived of the old client side full text index
 * (ADR 0008): the index, its tokenizer and its cursor paging are gone, the
 * query itself is the same shape.
 */
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

/**
 * The scope of an unscoped search: every entity, every field. The popup's plain
 * search box uses it, so "pasta basics" is one group of two terms looked for
 * anywhere, rather than the tag UI's per-term scope picker.
 */
export const ANY_SCOPE: QueryScope = { type: TYPE_ALL, field: FIELD_ALL };

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
