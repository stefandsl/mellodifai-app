import { Icon } from "@astryxdesign/core/Icon";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
} from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import type { CompareCell } from "@/lib/site/plans";
import { CheckGlyph, DashGlyph } from "./icons";

export type CompareTableProps = {
  labelledBy: string;
  featureColumn: string;
  /** Head row: one column per plan, the price under the name. */
  columns: readonly { name: string; price: string }[];
  groups: readonly {
    label: string;
    rows: readonly { label: string; cells: readonly CompareCell[] }[];
  }[];
  /** Words of a text cell, by key. */
  cellText: (key: Exclude<CompareCell, boolean>) => string;
  included: string;
  notIncluded: string;
};

// The plans in one real table: a head row with the plans, then one body per group, each opened
// by its group label. A tick or a dash says included or not, with the words for screen readers.
export function CompareTable({
  labelledBy,
  featureColumn,
  columns,
  groups,
  cellText,
  included,
  notIncluded,
}: CompareTableProps) {
  return (
    <Table
      aria-labelledby={labelledBy}
      className="site-compare"
      density="balanced"
      verticalAlign="middle"
      textOverflow="wrap"
    >
      <TableHeader>
        <TableRow>
          <TableHeaderCell scope="col" className="site-compare__corner">
            <VisuallyHidden>{featureColumn}</VisuallyHidden>
          </TableHeaderCell>
          {columns.map((c) => (
            <TableHeaderCell
              key={c.name}
              scope="col"
              className="site-compare__plan"
            >
              <Text weight="medium" className="site-compare__plan-name">
                {c.name}
              </Text>
              <Text type="supporting" color="secondary">
                {c.price}
              </Text>
            </TableHeaderCell>
          ))}
        </TableRow>
      </TableHeader>
      {groups.map((g) => (
        <TableBody key={g.label}>
          <TableRow className="site-compare__group-row">
            <TableHeaderCell scope="rowgroup" className="site-compare__group">
              {g.label}
            </TableHeaderCell>
            {columns.map((c) => (
              <TableCell
                key={c.name}
                aria-hidden="true"
                className="site-compare__group"
              />
            ))}
          </TableRow>
          {g.rows.map((r) => (
            <TableRow key={r.label}>
              <TableHeaderCell scope="row" className="site-compare__feature">
                {r.label}
              </TableHeaderCell>
              {r.cells.map((cell, i) => (
                <TableCell
                  // The cells of a row are fixed by plan position.
                  // biome-ignore lint/suspicious/noArrayIndexKey: one cell per plan column
                  key={i}
                  className="site-compare__cell"
                  data-cell={typeof cell === "boolean" ? String(cell) : "text"}
                >
                  {typeof cell === "boolean" ? (
                    <>
                      <Icon
                        icon={cell ? CheckGlyph : DashGlyph}
                        size="sm"
                        color={cell ? "primary" : "secondary"}
                      />
                      <VisuallyHidden>
                        {cell ? included : notIncluded}
                      </VisuallyHidden>
                    </>
                  ) : (
                    <Text type="supporting">{cellText(cell)}</Text>
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      ))}
    </Table>
  );
}
