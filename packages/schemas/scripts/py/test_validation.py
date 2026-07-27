import json
import sys
import os

from validation import validate_app_config

def detect_target_type(json_data):
    """Auto-detect the target type from JSON data."""
    if not isinstance(json_data, dict):
        return None
    
    if "appType" in json_data and "layout" in json_data:
        return "WebAppProps"
    elif "title" in json_data and "slug" in json_data and ("pageType" in json_data or "type" in json_data):
        # Detect specific page type
        page_type = json_data.get("pageType") or json_data.get("type")
        if page_type in ["WebPageProps"]:
            return "WebPageProps"
        elif page_type in ["BlogMainPageProps", "BlogMainPage"]:
            return "BlogMainPageProps"
        elif page_type in ["BlogPostPageProps", "BlogPostPage"]:
            return "BlogPostPageProps"
        elif page_type in ["Page", "Default"]:
            return "WebPageProps"  # Default page type
        return "WebPageProps"  # Fallback
    elif "title" in json_data and "slug" in json_data:
        return "WebPageProps"
    elif "componentType" in json_data:
        return json_data["componentType"]
    
    return None

def run_validation_on_file(file_path: str):
    """
    Loads a JSON file and runs the validation script on its content.

    Args:
        file_path: The path to the JSON configuration file.
    """
    # Check if the file exists
    if not os.path.exists(file_path):
        print(f"Error: The file '{file_path}' was not found.")
        return

    print(f"--- Running validation on: {os.path.basename(file_path)} ---")

    try:
        # Open and read the entire file content into a string
        with open(file_path, 'r', encoding='utf-8') as f:
            json_string = f.read()
    except Exception as e:
        print(f"Error reading file: {e}")
        return
    
    # Parse JSON to detect type
    try:
        json_data = json.loads(json_string)
        target_type = detect_target_type(json_data)
        
        if not target_type:
            print("\n❌ ERROR: Cannot detect target type")
            print("The file must have one of:")
            print("  - 'appType' and 'layout' for WebApp")
            print("  - 'title' and 'slug' for Page")
            print("  - 'componentType' for components")
            return
        
        print(f"Detected type: {target_type}\n")
    except json.JSONDecodeError as e:
        print(f"Error parsing JSON: {e}")
        return
    
    # Call the validation function with the JSON string
    validation_result = validate_app_config(json_string, target_type)
    is_valid = validation_result["valid"]
    errors_list = validation_result["errors"]
    message = "\n".join(errors_list) if errors_list else ""

    # Print the results in a clear format
    if is_valid:
        print("\n✅ RESULT: VALID")
    else:
        print("\n❌ RESULT: INVALID")
    
    print("\n--- Details ---")
    print(message)
    print("--------------------")


if __name__ == "__main__":
    # The script expects exactly one command-line argument: the path to the JSON file.
    if len(sys.argv) != 2:
        print("Usage: python test_validation.py <path_to_your_json_file.json>")
        sys.exit(1)
    
    # Get the file path from the command-line arguments
    json_file_path = sys.argv[1]
    
    run_validation_on_file(json_file_path)

