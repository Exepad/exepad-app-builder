// src/interfaces/data/index.ts

/**
 * Data layer interfaces for Exepad Runtime
 * Defines static dataset structures used by StaticBackend
 */

/**
 * Defines a single field within a dataset schema, including its type and display properties.
 */
export interface FieldDefProps {
  /** The field name matching the key in each data record (e.g., 'email', 'created_at'). */
  name: string;
  /** The data type, used for formatting and input generation. */
  type: 'string' | 'number' | 'boolean' | 'date' | 'url' | 'email' | 'currency';
  /** Display label shown in table headers and form labels. Defaults to the titleCase of the field name. */
  label?: string;
  /** If true, the field is required when generating forms from this schema. @default false */
  required?: boolean;
  /** Format string for display rendering (e.g., 'YYYY-MM-DD' for dates, '$0,0.00' for currency). */
  format?: string;
}

/**
 * Defines the structure of a dataset, including field definitions and the primary key.
 */
export interface DatasetSchemaProps {
  /** Ordered list of field definitions describing each column in the dataset. */
  fields: FieldDefProps[];
  /** The field name used as the primary key for record identification. @default 'id' */
  primaryKey?: string;
}

/**
 * Defines a static dataset with data embedded directly in the app config.
 * Used by StaticBackend.data.datasets.
 */
export interface StaticDatasetProps {
  /** Dataset type discriminator, always 'static' for inline data. */
  type: 'static';

  /** Optional schema to help the LLM and components understand the data structure. */
  schema?: DatasetSchemaProps;

  /** Array of data objects, each should include a field matching the schema's primaryKey. */
  records: Record<string, any>[];

  /** If true, the records were AI-generated and a "sample data" banner is shown in the UI. @default false */
  generated?: boolean;

  /** Descriptive hint for AI data generation (e.g., 'e-commerce products with price and category'). */
  generationHint?: string;

  /** Metadata for truncated datasets that are too large to embed fully. */
  _meta?: {
    /** Total number of records in the full dataset. */
    totalCount?: number;
    /** If true, the records array does not contain all available data. */
    truncated?: boolean;
    /** Description of where the full dataset can be retrieved. */
    sourceHint?: string;
  };
}
