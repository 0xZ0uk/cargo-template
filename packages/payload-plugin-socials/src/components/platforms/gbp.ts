import type { PlatformDescriptor } from './types.js'

import { firstOfType, parseDestinationResponse } from './shared.js'

const dateTimeParts = (value: string) => {
  const [dateValue, timeValue] = value.split('T')
  const [year, month, day] = dateValue.split('-').map(Number)
  const [hours, minutes] = (timeValue ?? '').split(':').map(Number)
  return {
    date: { day, month, year },
    time: Number.isFinite(hours)
      ? { hours, minutes: Number.isFinite(minutes) ? minutes : 0 }
      : undefined,
  }
}

export const gbpDescriptor: PlatformDescriptor = {
  id: 'gbp',
  // Every Google Business Profile post type uses images only.
  acceptedMedia: () => ['image'],
  applyTemplate: (resolved) => (resolved.gbpSummary ? { copy: resolved.gbpSummary } : undefined),
  buildInput: (state, assets) => {
    const firstImage = firstOfType(assets, 'image')
    const input: Record<string, unknown> = {
      imageFormat: state.format === 'ALERT' ? undefined : firstImage?.format,
      imageUrl: state.format === 'ALERT' ? undefined : firstImage?.url,
      languageCode: state.languageCode || undefined,
      locationResourceName: state.destinationId,
      summary: state.copy,
      topicType: state.format,
    }
    if (state.callToAction && state.format !== 'OFFER') {
      input.callToAction = {
        actionType: state.callToAction,
        url: state.callToAction === 'CALL' ? undefined : state.callToActionUrl,
      }
    }
    if (state.format === 'EVENT' || state.format === 'OFFER') {
      if (state.eventStart && state.eventEnd) {
        const start = dateTimeParts(state.eventStart)
        const end = dateTimeParts(state.eventEnd)
        input.event = {
          schedule: {
            endDate: end.date,
            endTime: end.time,
            startDate: start.date,
            startTime: start.time,
          },
          title: state.eventTitle,
        }
      }
    }
    if (state.format === 'OFFER') {
      input.offer = {
        couponCode: state.offerCode || undefined,
        redeemOnlineUrl: state.callToActionUrl || undefined,
        termsConditions: state.offerTerms || undefined,
      }
    }
    if (state.format === 'ALERT') {
      input.alertType = state.alertType
    }
    return input
  },
  buildStandaloneInput: (destinationId, format, assets) => ({
    locationResourceName: destinationId,
    topicType: format,
    imageUrl: firstOfType(assets, 'image')?.url,
  }),
  copyLabel: 'Summary',
  defaultFormat: 'STANDARD',
  destination: {
    parse: (body) => parseDestinationResponse(body, 'locations', 'resourceName'),
    path: '/gbp/locations',
  },
  formats: [
    { label: 'Update', value: 'STANDARD' },
    { label: 'Event', value: 'EVENT' },
    { label: 'Offer', value: 'OFFER' },
    { label: 'Alert', value: 'ALERT' },
  ],
  initialFormat: () => 'STANDARD',
  mediaRequired: (format) => format !== 'STANDARD' && format !== 'ALERT',
  supportsMultipleMedia: () => false,
  titleLeadsCopy: false,
  visibleFields: () => ['copy', 'gbpDetails'],
}
