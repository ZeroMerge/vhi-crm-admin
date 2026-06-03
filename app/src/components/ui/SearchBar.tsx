import * as React from 'react';
import { Search } from 'lucide-react';

interface SearchBarProps extends React.InputHTMLAttributes<HTMLInputElement> {
  onSearch?: (value: string) => void;
}

export const SearchBar = React.forwardRef<HTMLInputElement, SearchBarProps>(
  ({ onChange, onSearch, placeholder = 'Search...', ...props }, ref) => {
    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (onChange) onChange(e);
      if (onSearch) onSearch(e.target.value);
    };

    return (
      <div className="search-bar-wrapper">
        <Search className="search-bar-icon" size={16} />
        <input
          type="text"
          className="search-bar-input"
          placeholder={placeholder}
          onChange={handleSearchChange}
          ref={ref}
          {...props}
        />
      </div>
    );
  }
);

SearchBar.displayName = 'SearchBar';
