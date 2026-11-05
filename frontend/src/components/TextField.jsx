import { TextField as MuiTextField } from '@mui/material';
import SearchSelect from './SearchSelect';

// Drop-in for MUI's TextField: `select` fields open a search popup (SearchSelect) instead of a dropdown.
export default function TextField(props) {
  return props.select ? <SearchSelect {...props} /> : <MuiTextField {...props} />;
}
