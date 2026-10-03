import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { Environment, FlagStatus } from '@/types'

interface UiState {
  flagFilters: {
    keyword: string
    status: FlagStatus | ''
    environment: Environment | ''
    team: string
  }
  reviewSelection: string[]
  sidebarOpen: boolean
}

const initialState: UiState = {
  flagFilters: {
    keyword: '',
    status: '',
    environment: '',
    team: '',
  },
  reviewSelection: [],
  sidebarOpen: true,
}

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setKeyword(state, action: PayloadAction<string>) {
      state.flagFilters.keyword = action.payload
    },
    setStatusFilter(state, action: PayloadAction<FlagStatus | ''>) {
      state.flagFilters.status = action.payload
    },
    setEnvironmentFilter(state, action: PayloadAction<Environment | ''>) {
      state.flagFilters.environment = action.payload
    },
    setTeamFilter(state, action: PayloadAction<string>) {
      state.flagFilters.team = action.payload
    },
    toggleReviewSelection(state, action: PayloadAction<string>) {
      const index = state.reviewSelection.indexOf(action.payload)
      if (index >= 0) state.reviewSelection.splice(index, 1)
      else state.reviewSelection.push(action.payload)
    },
    clearReviewSelection(state) {
      state.reviewSelection = []
    },
  },
})

export const {
  setKeyword,
  setStatusFilter,
  setEnvironmentFilter,
  setTeamFilter,
  toggleReviewSelection,
  clearReviewSelection,
} = uiSlice.actions

export default uiSlice.reducer
