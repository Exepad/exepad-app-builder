#!/usr/bin/env python3
"""
Test script to validate all example files in examples or public directories.
Runs validation on each JSON file and outputs results to a report file.

Usage:
    python test_examples_validation.py                    # Validates all files in src/schemas/examples directory
    python test_examples_validation.py public             # Validates all files in public/example directory
    python test_examples_validation.py <path_to_file>     # Validates a single specific file
"""

import json
import os
import sys
import glob
from datetime import datetime
from validation import validate_app_config

def validate_examples_batch(use_public=False):
    """
    Validates all JSON files in the examples directory and generates a report.
    
    Args:
        use_public (bool): If True, validate files in public/example directory.
                          If False, validate files in src/schemas/examples directory.
    """
    # Define paths
    current_dir = os.path.dirname(os.path.abspath(__file__))
    
    if use_public:
        # Go up to project root and then to apps/runtime/public/example
        examples_dir = os.path.join(current_dir, '..', '..', '..', '..', 'apps', 'runtime', 'public', 'example')
        output_file = os.path.join(current_dir, 'public_examples_validation_report.txt')
    else:
        # Use internal examples directory
        examples_dir = os.path.join(current_dir, '..', '..', 'data', 'examples')
        output_file = os.path.join(current_dir, 'examples_validation_report.txt')
    
    # Check if examples directory exists
    if not os.path.exists(examples_dir):
        print(f"Error: Examples directory '{examples_dir}' not found.")
        return
    
    # Get all JSON files in the examples directory (recursively)
    json_files = []
    for root, dirs, files in os.walk(examples_dir):
        for file in files:
            if file.endswith('.json') and not file.startswith('catalog_'):
                json_files.append(os.path.join(root, file))
    
    if not json_files:
        print(f"No JSON files found in '{examples_dir}'")
        return
    
    # Sort files for consistent output
    json_files.sort()
    
    print(f"Found {len(json_files)} JSON files to validate...")
    print(f"Results will be written to: {output_file}")
    
    # Prepare results
    results = []
    valid_count = 0
    invalid_count = 0
    error_count = 0
    
    # Process each file
    skipped_count = 0
    for i, file_path in enumerate(json_files, 1):
        filename = os.path.basename(file_path)
        print(f"[{i}/{len(json_files)}] Validating: {filename}")
        
        try:
            # Read the file content
            with open(file_path, 'r', encoding='utf-8') as f:
                json_string = f.read()
            
            # Parse JSON to check if it's a WebAppProps
            try:
                json_data = json.loads(json_string)
                # WebAppProps detection: has uuid, name, alias and either frontend or backend
                # This supports the new nested format (no appType field)
                is_webapp = (
                    isinstance(json_data, dict) and 
                    'uuid' in json_data and 
                    'name' in json_data and 
                    'alias' in json_data and
                    ('frontend' in json_data or 'backend' in json_data)
                )
                if not is_webapp:
                    print(f"  ⏭️  SKIPPED (not a WebAppProps)")
                    skipped_count += 1
                    continue
            except json.JSONDecodeError:
                pass  # Let the validator handle JSON errors
            
            # Run validation
            validation_result = validate_app_config(json_string, "WebAppProps")
            is_valid = validation_result["valid"]
            errors = validation_result["errors"]
            
            # Store result
            result = {
                'filename': filename,
                'path': file_path,
                'is_valid': is_valid,
                'errors': errors
            }
            results.append(result)
            
            # Update counters
            if is_valid:
                valid_count += 1
                print(f"  ✅ VALID")
            else:
                invalid_count += 1
                print(f"  ❌ INVALID ({len(errors)} errors)")
                
        except Exception as e:
            error_count += 1
            print(f"  💥 ERROR: {str(e)}")
            result = {
                'filename': filename,
                'path': file_path,
                'is_valid': False,
                'errors': [f"Processing error: {str(e)}"]
            }
            results.append(result)
    
    # Generate report
    generate_report(results, output_file, valid_count, invalid_count, error_count)
    
    # Print summary
    print(f"\n📊 VALIDATION SUMMARY:")
    print(f"  Total files: {len(json_files)}")
    print(f"  ⏭️  Skipped (not WebAppProps): {skipped_count}")
    print(f"  ✅ Valid: {valid_count}")
    print(f"  ❌ Invalid: {invalid_count}")
    print(f"  💥 Errors: {error_count}")
    print(f"  📄 Report saved to: {output_file}")

def generate_report(results, output_file, valid_count, invalid_count, error_count):
    """
    Generates a detailed validation report and writes it to a file.
    """
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write("=" * 80 + "\n")
        f.write("LEAPDO EXAMPLES VALIDATION REPORT\n")
        f.write("=" * 80 + "\n")
        f.write(f"Generated: {timestamp}\n")
        f.write(f"Total files processed: {len(results)}\n")
        f.write(f"Valid: {valid_count}\n")
        f.write(f"Invalid: {invalid_count}\n")
        f.write(f"Errors: {error_count}\n")
        f.write("=" * 80 + "\n\n")
        
        # Summary section
        f.write("SUMMARY BY STATUS\n")
        f.write("-" * 40 + "\n\n")
        
        # Valid files
        valid_files = [r for r in results if r['is_valid']]
        if valid_files:
            f.write(f"✅ VALID FILES ({len(valid_files)}):\n")
            for result in valid_files:
                f.write(f"  • {result['filename']}\n")
            f.write("\n")
        
        # Invalid files
        invalid_files = [r for r in results if not r['is_valid']]
        if invalid_files:
            f.write(f"❌ INVALID FILES ({len(invalid_files)}):\n")
            for result in invalid_files:
                error_count = len(result['errors']) if isinstance(result['errors'], list) else 1
                f.write(f"  • {result['filename']} ({error_count} errors)\n")
            f.write("\n")
        
        # Detailed results
        f.write("DETAILED VALIDATION RESULTS\n")
        f.write("-" * 40 + "\n\n")
        
        for result in results:
            f.write(f"File: {result['filename']}\n")
            f.write(f"Path: {result['path']}\n")
            f.write(f"Status: {'✅ VALID' if result['is_valid'] else '❌ INVALID'}\n")
            
            if not result['is_valid'] and result['errors']:
                f.write("Errors:\n")
                if isinstance(result['errors'], list):
                    for i, error in enumerate(result['errors'], 1):
                        f.write(f"  {i}. {error}\n")
                else:
                    f.write(f"  • {result['errors']}\n")
            
            f.write("-" * 60 + "\n\n")
        
        # End of report
        f.write("=" * 80 + "\n")
        f.write("END OF REPORT\n")
        f.write("=" * 80 + "\n")

def validate_single_file(file_path):
    """
    Validates a single JSON file and prints the results.
    
    Args:
        file_path: Path to the JSON file to validate.
    """
    # Check if the file exists
    if not os.path.exists(file_path):
        print(f"Error: The file '{file_path}' was not found.")
        return
    
    # Check if it's a JSON file
    if not file_path.endswith('.json'):
        print(f"Error: The file '{file_path}' is not a JSON file.")
        return
    
    filename = os.path.basename(file_path)
    print(f"--- Running validation on: {filename} ---")
    print(f"Full path: {file_path}\n")
    
    try:
        # Read the file content
        with open(file_path, 'r', encoding='utf-8') as f:
            json_string = f.read()
        
        # Run validation
        validation_result = validate_app_config(json_string, "WebAppProps")
        is_valid = validation_result["valid"]
        errors = validation_result["errors"]
        
        # Print the results in a clear format
        if is_valid:
            print("\n✅ RESULT: VALID")
        else:
            print("\n❌ RESULT: INVALID")
        
        print("\n--- Details ---")
        if isinstance(errors, list):
            if errors:
                for i, error in enumerate(errors, 1):
                    print(f"{i}. {error}")
            else:
                print("No errors found.")
        else:
            print(errors)
        print("--------------------")
        
    except Exception as e:
        print(f"\n💥 ERROR: {str(e)}")
        print("--------------------")

if __name__ == "__main__":
    # Check if a file path or 'public' argument was provided
    if len(sys.argv) == 2:
        arg = sys.argv[1]
        
        # Check if the argument is 'public' to validate public examples
        if arg == "public":
            validate_examples_batch(use_public=True)
        # Otherwise, treat it as a file path for single file validation
        elif os.path.isfile(arg):
            validate_single_file(arg)
        else:
            print(f"Error: '{arg}' is not a valid file or 'public' keyword.")
            print("\nUsage:")
            print("  python test_examples_validation.py                    # Validates all files in src/schemas/examples")
            print("  python test_examples_validation.py public             # Validates all files in public/example")
            print("  python test_examples_validation.py <path_to_file>     # Validates a single specific file")
            sys.exit(1)
    elif len(sys.argv) == 1:
        # No arguments provided, validate internal examples
        validate_examples_batch(use_public=False)
    else:
        print("Usage:")
        print("  python test_examples_validation.py                    # Validates all files in src/schemas/examples")
        print("  python test_examples_validation.py public             # Validates all files in public/example")
        print("  python test_examples_validation.py <path_to_file>     # Validates a single specific file")
        sys.exit(1) 