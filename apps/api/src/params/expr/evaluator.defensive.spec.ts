/**
 * Branches defensives de l'evaluateur : un arbre que le parseur ne produit jamais doit echouer proprement
 * (code `syntax`), sans exception (ENF-PAR-02, T-50). Le parseur est remplace pour fabriquer ces arbres.
 */
import { evaluate } from './evaluator';
import * as parser from './parser';

jest.mock('./parser', () => ({ ...jest.requireActual('./parser'), parse: jest.fn() }));
const parseMock = parser.parse as jest.MockedFunction<typeof parser.parse>;

describe('evaluator defensive branches', () => {
  it('rejects an unknown node type', () => {
    parseMock.mockReturnValueOnce({ t: 'bizarre' } as never);
    expect(evaluate('x')).toMatchObject({ ok: false, error: 'syntax' });
  });

  it('rejects an unknown binary operator', () => {
    parseMock.mockReturnValueOnce({ t: 'binary', op: '??', left: { t: 'lit', v: 1 }, right: { t: 'lit', v: 2 } });
    expect(evaluate('x')).toMatchObject({ ok: false, error: 'syntax', message: 'unknown operator ??' });
  });

  it('rethrows errors that are not expression errors', () => {
    parseMock.mockImplementationOnce(() => {
      throw new TypeError('bug');
    });
    expect(() => evaluate('x')).toThrow('bug');
  });
});
