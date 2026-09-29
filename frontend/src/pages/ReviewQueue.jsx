import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import FilterBar from "../components/FilterBar";
import InvoiceTable from "../components/InvoiceTable";
import { getInvoices, getFilterOptions } from "../lib/api";

const EMPTY_FILTERS = { subsidiary: "", erp_source: "", severity: "", status: "", vendor: "" };

export default function ReviewQueue() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState({
    ...EMPTY_FILTERS,
    ...Object.fromEntries(searchParams.entries()),
  });
  const [invoices, setInvoices] = useState([]);
  const [subsidiaries, setSubsidiaries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getFilterOptions().then((opts) => setSubsidiaries(opts.subsidiaries));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getInvoices(filters).then((data) => {
      if (cancelled) return;
      setInvoices(data);
      setLoading(false);
    });
    setSearchParams(Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), {
      replace: true,
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line
  }, [filters]);

  return (
    <>
      <div className="page-header">
        <h1>Review Queue</h1>
      </div>
      <FilterBar
        filters={filters}
        onChange={setFilters}
        subsidiaries={subsidiaries}
        resultCount={invoices.length}
      />
      {loading ? <p className="text-secondary">Loading…</p> : <InvoiceTable invoices={invoices} />}
    </>
  );
}
