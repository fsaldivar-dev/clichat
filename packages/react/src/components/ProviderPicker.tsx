import type { CLIProvider } from "@clichat/core";

export interface ProviderPickerProps {
  providers: CLIProvider[];
  onSelect: (provider: CLIProvider) => void;
  /** Optional context hint shown below the picker */
  contextHint?: string;
}

export function ProviderPicker({ providers, onSelect, contextHint }: ProviderPickerProps) {
  return (
    <div className="clichat-picker">
      <p className="clichat-picker__hint">Choose a provider:</p>
      <div className="clichat-picker__options">
        {providers.map((provider) => (
          <button
            key={provider.id}
            className="clichat-picker__option"
            onClick={() => onSelect(provider)}
          >
            {provider.icon && (
              <span className="clichat-picker__icon">{provider.icon}</span>
            )}
            <span className="clichat-picker__label">{provider.label}</span>
          </button>
        ))}
      </div>
      {contextHint && (
        <p className="clichat-picker__context">{contextHint}</p>
      )}
    </div>
  );
}
