import { test, mock } from "node:test";
import assert from "node:assert/strict";
import OperationStateError, {
  OperationStateErrorCode,
} from "@databricks/sql/dist/errors/OperationStateError";
import { TOperationState } from "@databricks/sql/thrift/TCLIService_types";
import {
  warehouseDiagnostic,
  withApiErrors,
} from "../src/lib/server/api-errors";
import { recordFailure, failureDetails } from "../src/lib/server/error-context";
import { createSqlExecutor } from "../src/lib/server/warehouse";
import type IDBSQLClient from "@databricks/sql/dist/contracts/IDBSQLClient";

function operationError(errorMessage: string, sqlState = "HY000") {
  // Actual SDK error class thrown by ThriftOperationBackend.waitUntilReady.
  return new OperationStateError(OperationStateErrorCode.Error, {
    operationState: TOperationState.ERROR_STATE,
    errorMessage,
    sqlState,
  } as any);
}
test("a query permission failure mentioning OAuth is not mislabeled as app authentication", () => {
  const error = operationError(
    "[INSUFFICIENT_PERMISSIONS] OAuth identity cannot SELECT source_data",
    "42501",
  );
  assert.equal(warehouseDiagnostic(error).code, "WAREHOUSE_PERMISSION");
  assert.equal(
    failureDetails(error).warehouseErrorClass,
    "INSUFFICIENT_PERMISSIONS",
  );
  assert.equal(failureDetails(error).sqlState, "42501");
});
test("SQL syntax errors mentioning invalid tokens or OAuth columns remain query errors", () => {
  assert.equal(
    warehouseDiagnostic(
      operationError(
        "[PARSE_SYNTAX_ERROR] invalid syntax near token oauth_column",
        "42601",
      ),
    ).code,
    "WAREHOUSE_QUERY",
  );
});
test("mentioning OAuth alone in an operation failure is not evidence of invalid app credentials", () => {
  const diagnostic = warehouseDiagnostic(
    operationError("[INTERNAL_ERROR] provider OAuth context not available"),
  );
  assert.equal(diagnostic.code, "WAREHOUSE_QUERY");
});
test("warehouse-side authentication failures have a query access diagnosis", () => {
  assert.equal(
    warehouseDiagnostic(
      operationError(
        "[INVALID_ACCESS_TOKEN] Authentication failed during query execution",
        "28000",
      ),
    ).code,
    "WAREHOUSE_QUERY_ACCESS",
  );
  assert.equal(
    warehouseDiagnostic(new Error("invalid_client")).code,
    "WAREHOUSE_AUTHENTICATION",
  );
});
test("operation errors preserve safe metadata and log a redacted server message without exposing SQL or credentials", async () => {
  process.env.DATABRICKS_CLIENT_SECRET = "operation-test-secret";
  const error = operationError(
    "[DATA_SOURCE_ERROR] provider rejected 'customer-private-value' operation-test-secret https://example.invalid/auth Bearer private-bearer SELECT private_table",
    "HY000",
  );
  recordFailure(
    error,
    "fetch_results",
    { p0: "customer-private-value" },
    {
      operationId: "01234567-89ab-cdef-0123-456789abcdef",
      sourceTables: ["dim_customer"],
    },
  );
  const logger = mock.method(console, "error", () => {});
  try {
    const response = await withApiErrors(async () => {
      throw error;
    })(new Request("http://localhost/api/reports"));
    const body = await response.json(),
      log = JSON.parse(logger.mock.calls[0].arguments[0]);
    assert.equal(body.diagnosticsVersion, 4);
    assert.equal(body.warehouseErrorClass, "DATA_SOURCE_ERROR");
    assert.equal(body.failurePhase, "warehouse_query");
    assert.equal(body.sqlState, "HY000");
    assert.equal(body.operationId, "01234567-89ab-cdef-0123-456789abcdef");
    assert.deepEqual(body.sourceTables, ["dim_customer"]);
    assert.equal(body.warehouseMessage, undefined);
    assert.equal(body.stackFrames, undefined);
    assert.match(log.warehouseMessage, /DATA_SOURCE_ERROR/);
    assert.doesNotMatch(
      JSON.stringify(body) + JSON.stringify(log),
      /customer-private-value|operation-test-secret|example\.invalid|private-bearer|private_table/,
    );
  } finally {
    logger.mock.restore();
    delete process.env.DATABRICKS_CLIENT_SECRET;
  }
});
test("query execution captures the operation identifier and source tables even when result fetching fails", async () => {
  process.env.DATABRICKS_HOST = "https://test.cloud.databricks.com";
  process.env.DATABRICKS_WAREHOUSE_ID = "test";
  const error = operationError(
    "[TABLE_OR_VIEW_NOT_FOUND] Cannot resolve source",
    "42P01",
  );
  const operation = {
    id: "01234567-89ab-cdef-0123-456789abcdef",
    async fetchChunk() {
      throw error;
    },
    async close() {},
  };
  const client = {
    async connect() {
      return client;
    },
    async openSession() {
      return {
        async executeStatement() {
          return operation;
        },
        async close() {},
      };
    },
    async close() {},
  };
  const executor = createSqlExecutor(() => client as unknown as IDBSQLClient);
  try {
    await assert.rejects(
      executor.execute({
        sql: "SELECT * FROM `fixture`.`gold`.`dim_customer`",
        parameters: {},
      }),
    );
    const details = failureDetails(error);
    assert.equal(details.stage, "fetch_results");
    assert.equal(details.operationId, operation.id);
    assert.deepEqual(details.sourceTables, ["dim_customer"]);
    assert.equal(warehouseDiagnostic(error).code, "WAREHOUSE_SCHEMA");
  } finally {
    await executor.close();
  }
});
